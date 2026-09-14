import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

import { Empty } from "./group-admins";

/**
 * The operator's private note about this house.
 *
 * Operator-only and STRUCTURALLY so: `notes` appears on
 * `SuperAdmin::GroupSerializer` and on no house-facing serializer in the app, and
 * a request spec on the API side holds that line. It is free text about a house
 * and the people in it — "chasing them about the card that keeps declining" —
 * which is also why the audit log records that a note was written and never what
 * it said.
 *
 * Rendered in full, with newlines kept: a note somebody wrote as three lines is a
 * note that means something as three lines, and a card that collapsed it would
 * make the box a worse place to write than a text file. The 2,000-character
 * ceiling (`Group::NOTES_MAX`) is what keeps "in full" a promise this card can
 * actually make; the editor's counter enforces the same number before the
 * request, so a long paste is stopped rather than refused.
 *
 * Editing it is the third action in the header — see `GroupActions`.
 */
export function GroupNotes({ notes }: { notes: string | null }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Note</CardTitle>
        <CardDescription>Only operators see this. Nobody in the house ever does.</CardDescription>
      </CardHeader>
      <CardContent>
        {notes ? (
          <p className="text-sm break-words whitespace-pre-wrap">{notes}</p>
        ) : (
          <Empty>No note yet. Use &ldquo;Add a note&rdquo; above.</Empty>
        )}
      </CardContent>
    </Card>
  );
}
