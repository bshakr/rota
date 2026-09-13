require "rails_helper"

RSpec.describe User do
  it "is valid with the factory" do
    expect(build(:user)).to be_valid
  end

  it "requires a WorkOS user to map onto" do
    user = build(:user, workos_user_id: nil)

    expect(user).not_to be_valid
    expect(user.errors[:workos_user_id]).to be_present
  end

  it "refuses two users for the same WorkOS user" do
    create(:user, workos_user_id: "user_taken")
    duplicate = build(:user, workos_user_id: "user_taken")

    expect(duplicate).not_to be_valid
    expect(duplicate.errors[:workos_user_id]).to be_present
  end

  it "requires an email" do
    user = build(:user, email: "")

    expect(user).not_to be_valid
    expect(user.errors[:email]).to be_present
  end

  # WorkOS does not always have a name, and the just-in-time upsert on an authenticated request
  # must never fail for want of a display string.
  it "does not require a name" do
    expect(build(:user, name: nil)).to be_valid
  end

  # The user half of just-in-time provisioning, pulled out of GroupAdmin.provision! so that
  # POST /api/sign_ins — which has a verified token and may have no organization at all — upserts
  # the admin through the very same code the house path uses, rather than through a second one that
  # happens to agree today.
  describe ".provision!" do
    def claims(sub: "user_01ALICE", org_id: "org_01FLAT", role: "admin", email: nil, name: nil, jti: nil)
      WorkosAccessToken::Claims.new(
        workos_user_id: sub, workos_organization_id: org_id, role: role, email: email, name: name, jti: jti
      )
    end

    it "creates the admin on a first sighting" do
      user = described_class.provision!(claims(email: "alice@example.com", name: "Alice"))

      expect(user).to have_attributes(workos_user_id: "user_01ALICE", email: "alice@example.com", name: "Alice")
    end

    it "needs no organization, because a sign-in before any house is still a sign-in" do
      user = described_class.provision!(claims(org_id: nil))

      expect(user).to be_persisted
      expect(user.groups).to be_empty
    end

    it "is idempotent" do
      first = described_class.provision!(claims)

      expect { described_class.provision!(claims) }.not_to change(described_class, :count)
      expect(described_class.provision!(claims)).to eq(first)
    end

    # WorkOS owns the email and the name, so a claim that carries either wins. It owns nothing else
    # on this row.
    it "re-syncs the email and name from the claim" do
      described_class.provision!(claims(email: "alice@example.com", name: "Alice"))

      user = described_class.provision!(claims(email: "alice@work.example.com", name: "Alice Smith"))

      expect(user).to have_attributes(email: "alice@work.example.com", name: "Alice Smith")
    end

    it "does not invent an email that could be delivered to" do
      expect(described_class.provision!(claims(email: nil)).email).to eq("user_01ALICE@users.workos.invalid")
    end

    # The steady state, on both the sign-in path and every authenticated read behind it.
    it "writes nothing when the admin already exists and nothing would change" do
      described_class.provision!(claims)

      expect { described_class.provision!(claims) }.not_to change { described_class.maximum(:updated_at) }
    end

    # The sign-in callback and the dashboard's first /api/me land within milliseconds of each other
    # on a brand new admin, both wanting to create this row. The unique index is the referee, and
    # the loser must end up with the winner's row rather than an exception.
    it "finds the user a concurrent request created between the lookup and the insert" do
      winner = create(:user, workos_user_id: "user_01ALICE")
      allow(described_class).to receive(:find_by).and_return(nil, winner)

      expect(described_class.provision!(claims)).to eq(winner)
      expect(described_class.where(workos_user_id: "user_01ALICE").count).to eq(1)
    end

    it "re-raises when the record is invalid for a reason other than the race" do
      expect { described_class.provision!(claims(sub: "")) }.to raise_error(ActiveRecord::RecordInvalid)
    end
  end

  it "reaches its groups through group_admins" do
    user = create(:user)
    group = create(:group)
    create(:group_admin, user: user, group: group)

    expect(user.groups).to contain_exactly(group)
  end
end
