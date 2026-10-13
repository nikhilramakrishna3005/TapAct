/** True only when this board response is still the latest request for the selected duel. */
export function isCurrentBoardResponse(input: {
  requestId: string;
  selectedId: string | null;
  generation: number;
  latestGeneration: number;
}): boolean {
  return input.selectedId === input.requestId && input.generation === input.latestGeneration;
}

/** Completed duel ids only. Active boards do not belong in Battle Showcase history. */
export function showcaseHistoryKey(items: { id: string; status: string }[]): string {
  return items
    .filter((item) => item.status === "completed")
    .map((item) => item.id)
    .sort()
    .join("|");
}
