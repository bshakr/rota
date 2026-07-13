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

    # The token has no timezone, so a JIT-created group is a guess (UTC) until a human confirms it.
    it "leaves a newly-created group's timezone unconfirmed" do
      group = described_class.provision!(claims).group

      expect(group.timezone).to eq("UTC")
      expect(group.timezone_confirmed?).to be(false)
    end

    # The steady-state path: existing membership, unchanged role, no email/name in the claim. It
    # must not write, or every authenticated read becomes a write.
    it "writes nothing when the membership already exists and nothing would change" do
      described_class.provision!(claims)

      expect {
        result = described_class.provision!(claims)
        expect(result.user).to be_present
        expect(result.group).to be_present
      }.to not_change { [ User.maximum(:updated_at), Group.maximum(:updated_at), described_class.maximum(:updated_at) ] }
    end

    it "does not re-query the user and group it already loaded on the fast path" do
      described_class.provision!(claims)

      group_admin = described_class.provision!(claims)

      expect(group_admin.association(:user)).to be_loaded
      expect(group_admin.association(:group)).to be_loaded
    end

    # The concurrent request has already inserted the group by the time we look for it and miss.
    # Our INSERT then loses to the unique index, and we must end up with the winner's row.
    it "finds the group a concurrent request created between the lookup and the insert" do
      winner = create(:group, workos_organization_id: "org_01FLAT", name: "Flat 3, Alma Road")
      allow(Group).to receive(:find_by).and_return(nil, winner)

      group_admin = described_class.provision!(claims)

      expect(group_admin.group).to eq(winner)
      # Scoped to this org — the seeded demo house means the test database is never empty.
      expect(Group.where(workos_organization_id: "org_01FLAT").count).to eq(1)
    end

    it "finds the user a concurrent request created between the lookup and the insert" do
      winner = create(:user, workos_user_id: "user_01ALICE")
      # Three lookups miss before the winner surfaces: the read-only fast path, the upsert's own
      # look-before-insert, then the rescue after our INSERT loses to the unique index.
      allow(User).to receive(:find_by).and_return(nil, nil, winner)

      group_admin = described_class.provision!(claims)

      expect(group_admin.user).to eq(winner)
      # Scoped to this workos_user_id — the seeded demo house means the test database is never empty.
      expect(User.where(workos_user_id: "user_01ALICE").count).to eq(1)
    end

    # Proves the savepoint (requires_new: true) is load-bearing, not decoration — the one thing the
    # stubbed race tests above CANNOT prove.
    #
    # The model's `uniqueness` validation turns an ordinary duplicate into a RecordInvalid with no
    # INSERT at all, so it never poisons a transaction and never needs a savepoint. The savepoint
    # exists for the TRUE race: two requests both pass the validation while the row does not yet
    # exist, then collide at the database's unique index. This reproduces exactly that window — a
    # concurrent request commits the row (on its own connection, a second thread) in the gap between
    # our validation and our INSERT — so our INSERT hits a REAL PG unique violation mid-transaction.
    # Without requires_new that violation poisons the whole transaction and the rescue's re-read
    # raises PG::InFailedSqlTransaction; the savepoint is what lets the losing request recover to the
    # winner's row. Runs without transactional fixtures so provision!'s transaction is the real
    # outermost one, as in a request. Delete requires_new: true and this test goes red.
    context "under a real transaction (no fixture rollback)" do
      self.use_transactional_tests = false

      after do
        GroupAdmin.where(user: User.where(workos_user_id: "user_01ALICE")).delete_all
        User.where(workos_user_id: "user_01ALICE").delete_all
        Group.where(workos_organization_id: "org_01FLAT").delete_all
      end

      it "recovers when a concurrent request wins the race to the unique index" do
        raced = false
        # _create_record runs after validation and immediately before the INSERT — the exact TOCTOU
        # window. The only Group provision! creates here is org_01FLAT, so on the first one a second
        # thread (its own connection) commits the conflicting row, then our INSERT collides.
        allow_any_instance_of(Group).to receive(:_create_record).and_wrap_original do |original, *args|
          unless raced
            raced = true
            Thread.new { Group.create!(workos_organization_id: "org_01FLAT", name: "Winner", timezone: "Europe/London") }.join
          end
          original.call(*args)
        end

        group_admin = described_class.provision!(claims(org_id: "org_01FLAT"))

        expect(group_admin).to be_persisted
        expect(group_admin.group.name).to eq("Winner")
        expect(Group.where(workos_organization_id: "org_01FLAT").count).to eq(1)
      end
    end

    # A create that failed for a reason that is not the race must not be swallowed into a silent
    # "record not found" — it is a bug, and it has to look like one.
    it "re-raises when the record is invalid for a reason other than the race" do
      expect { described_class.provision!(claims(org_id: "org_01FLAT", role: "")) }
        .to raise_error(ActiveRecord::RecordInvalid)
    end
  end
end
