/**
 * podAdapters.ts — Retained for future use with third-party or external pods
 * that may not implement the PodVote interface natively.
 * All current APEX pods emit PodVote directly and do not require adaptation.
 */

import type { PodVote } from "@/src/domain/pods/types";

export function identityAdapter(vote: PodVote): PodVote {
  return vote;
}
