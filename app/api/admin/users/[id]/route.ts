import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient, SERVICE_ROLE_KEY } from "@/lib/supabase/admin";
import { isSuperadmin } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// DELETE /api/admin/users/[id] — permanently remove a login account.
//
// Guards:
//   • caller must be signed in AND a super-admin
//   • you cannot remove your own account
//   • super-admin accounts can never be removed here
//   • if the person has linked records (e.g. transactions they created), the
//     delete is refused and we suggest revoking access instead — this protects
//     the accounting audit trail.
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  if (!SERVICE_ROLE_KEY) {
    return NextResponse.json({ error: "Server not configured (missing service role key)." }, { status: 500 });
  }

  const { id } = await params;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  if (!isSuperadmin(user.email)) {
    return NextResponse.json({ error: "Only a super-admin can remove users." }, { status: 403 });
  }
  if (user.id === id) {
    return NextResponse.json({ error: "You cannot remove your own account." }, { status: 400 });
  }

  const admin = createAdminClient();

  const { data: target } = await admin.auth.admin.getUserById(id);
  if (!target?.user) {
    return NextResponse.json({ error: "That account no longer exists." }, { status: 404 });
  }
  if (isSuperadmin(target.user.email)) {
    return NextResponse.json({ error: "Super-admin accounts cannot be removed." }, { status: 400 });
  }

  // Deleting the auth user cascades to their profiles row.
  const { error } = await admin.auth.admin.deleteUser(id);
  if (error) {
    const linked = /foreign key|violates|constraint/i.test(error.message);
    return NextResponse.json(
      {
        error: linked
          ? "This person has records linked to their account (for example transactions they created), so it can't be deleted without losing that history. Set their role to Pending instead — that removes all access while keeping the records intact."
          : error.message,
      },
      { status: 400 },
    );
  }

  return NextResponse.json({ ok: true });
}
