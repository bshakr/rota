require "rails_helper"

RSpec.describe GroupAdmin do
  it "is valid with the factory" do
    expect(build(:group_admin)).to be_valid
  end

  it "requires a role" do
    group_admin = build(:group_admin, role: "")

    expect(group_admin).not_to be_valid
    expect(group_admin.errors[:role]).to be_present
  end

  # The row is upserted from the JWT claims on every authenticated request, so it has to be the
  # same row every time.
  it "refuses to admit the same user to the same group twice" do
    existing = create(:group_admin)
    duplicate = build(:group_admin, user: existing.user, group: existing.group)

    expect(duplicate).not_to be_valid
    expect(duplicate.errors[:user_id]).to be_present
  end

  it "allows one user to administer several groups" do
    existing = create(:group_admin)

    expect(build(:group_admin, user: existing.user, group: create(:group))).to be_valid
  end

  it "allows one group to have several admins" do
    existing = create(:group_admin)

    expect(build(:group_admin, user: create(:user), group: existing.group)).to be_valid
  end

  # Provisioning runs on every authenticated request, so its whole job is to be idempotent — and
  # to survive a race, because the first page load of a brand new group fires several API calls at
  # once and they all arrive here with nothing in the database yet. The unique index is the
  # referee; the request that loses re-reads the winner's row rather than blowing up.
  describe ".provision!" do
    def claims(sub: "user_01ALICE", org_id: "org_01FLAT", role: "admin", email: nil, name: nil)
      WorkosAccessToken::Claims.new(
        workos_user_id: sub, workos_organization_id: org_id, role: role, email: email, name: name
      )
    end

    it "creates the user, the group and the admin's place in it" do
      group_admin = described_class.provision!(claims(email: "alice@example.com", name: "Alice"))

      expect(group_admin.user).to have_attributes(workos_user_id: "user_01ALICE", email: "alice@example.com", name: "Alice")
      expect(group_admin.group).to have_attributes(workos_organization_id: "org_01FLAT", timezone: "UTC")
      expect(group_admin.role).to eq("admin")
    end

    it "is idempotent" do
      first = described_class.provision!(claims)

      expect { described_class.provision!(claims) }.not_to change(described_class, :count)
      expect(described_class.sole).to eq(first)
    end

    # WorkOS owns the role, so the claim wins. It owns nothing else on these rows.
    it "re-syncs the role from the claim" do
      described_class.provision!(claims(role: "admin"))

      expect(described_class.provision!(claims(role: "member")).role).to eq("member")
    end

    it "does not invent an email that could be delivered to" do
      group_admin = described_class.provision!(claims(email: nil))

      expect(group_admin.user.email).to eq("user_01ALICE@users.workos.invalid")
    end

    # The concurrent request has already inserted the group by the time we look for it and miss.
    # Our INSERT then loses to the unique index, and we must end up with the winner's row.
    it "finds the group a concurrent request created between the lookup and the insert" do
      winner = create(:group, workos_organization_id: "org_01FLAT", name: "Flat 3, Alma Road")
      allow(Group).to receive(:find_by).and_return(nil, winner)

      group_admin = described_class.provision!(claims)

      expect(group_admin.group).to eq(winner)
      expect(Group.count).to eq(1)
    end

    it "finds the user a concurrent request created between the lookup and the insert" do
      winner = create(:user, workos_user_id: "user_01ALICE")
      allow(User).to receive(:find_by).and_return(nil, winner)

      group_admin = described_class.provision!(claims)

      expect(group_admin.user).to eq(winner)
      expect(User.count).to eq(1)
    end

    # A create that failed for a reason that is not the race must not be swallowed into a silent
    # "record not found" — it is a bug, and it has to look like one.
    it "re-raises when the record is invalid for a reason other than the race" do
      expect { described_class.provision!(claims(org_id: "org_01FLAT", role: "")) }
        .to raise_error(ActiveRecord::RecordInvalid)
    end
  end
end
