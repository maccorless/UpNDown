# The earlier all-pairs network, kept only so test_model.py can check the legal-pairs version against it.
"""The policy and the critic.

The policy reads only what a player sees (its own hand, pile tops, counts, reactions, and with Tier B the played-card record). It scores
every (card, pile) pair with the same small networks for every card and every pile, so it has no slot order and no pile index: swapping
the two ascending piles (or the two descending ones) swaps its scores and changes nothing else. The critic reads the hidden cards too,
but only while training: it gives the learner a baseline and is not part of what is kept.
"""
import torch
import torch.nn as nn
import features as ft
from protocol import HAND, DECK


def mlp(i, h, o):
    return nn.Sequential(nn.Linear(i, h), nn.ReLU(), nn.Linear(h, o))


class Policy(nn.Module):
    def __init__(self, width=64):
        super().__init__()
        w = width
        self.record = mlp(DECK, 32, 16)
        self.glob = mlp(ft.N_GLOB + 16, w, w)
        self.pair = mlp(ft.N_PAIR + ft.N_CARD + ft.N_PILE + w, 2 * w, w)
        self.head = mlp(3 * w, 2 * w, 1)
        self.end = mlp(w + w, w, 1)
        self.hand_pool = nn.Linear(w, w)

    def forward(self, card, pair, pile, glob, record, mask):
        B = card.shape[0]
        g = torch.relu(self.glob(torch.cat([glob, self.record(record)], -1)))            # [B,w]
        w = g.shape[-1]
        c = card.unsqueeze(2).expand(-1, -1, 4, -1)                                       # [B,11,4,Fc]
        p = pile.unsqueeze(1).expand(-1, HAND, -1, -1)                                    # [B,11,4,Fp]
        gg = g.view(B, 1, 1, w).expand(-1, HAND, 4, -1)
        h = torch.relu(self.pair(torch.cat([pair, c, p, gg], -1)))                        # [B,11,4,w]
        valid = pair[..., 0:1]
        card_ctx = (h * valid).max(2).values                                              # [B,11,w] best over piles, symmetric in piles
        logit = self.head(torch.cat([h, card_ctx.unsqueeze(2).expand(-1, -1, 4, -1), gg], -1)).squeeze(-1)  # [B,11,4]
        hand_ctx = torch.relu(self.hand_pool((card_ctx * card[..., 0:1]).max(1).values))
        end = self.end(torch.cat([g, hand_ctx], -1))                                      # [B,1]
        logits = torch.cat([logit.flatten(1), end], -1).float()
        return logits.masked_fill(mask < 0.5, -1e9)


class Critic(nn.Module):
    def __init__(self, n_inputs, width=256):
        super().__init__()
        self.net = nn.Sequential(nn.Linear(n_inputs, width), nn.ReLU(), nn.Linear(width, width), nn.ReLU(), nn.Linear(width, 1))

    def forward(self, critic_in):
        return self.net(critic_in).squeeze(-1)
