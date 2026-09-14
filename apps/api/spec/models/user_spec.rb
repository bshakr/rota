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

  # The operator's "somebody just signed up" text (NewSignupAlertJob). It hangs off the row rather
  # than off the sign-in controller because the row is what is created exactly once: two callers
  # provision a user, several requests race to be the first, and only one INSERT survives.
  describe "the operator's signup alert" do
    def claims(sub: "user_01ALICE", org_id: "org_01FLAT", role: "admin")
      WorkosAccessToken::Claims.new(
        workos_user_id: sub, workos_organization_id: org_id, role: role, email: nil, name: nil, jti: nil
      )
    end

    # Resolved at boot from SIGNUP_ALERT_PHONE (see SmsBoot.signup_alert_phone_for), so the spec
    # swaps the resolved value rather than an env var.
    def alert_phone(number)
      allow(Rails.configuration.x.sms).to receive(:signup_alert_phone).and_return(number)
    end

    # A minute, not immediately: the sign-in callback fills in the email and name just after this
    # row appears, and the house arrives on the admin's next request, so a text sent now would say
    # "someone, no email shared. House: none yet" for very nearly every signup.
    it "texts the operator about a brand new admin, a minute after the row appears" do
      alert_phone("+447911123456")
      user = nil

      expect { user = create(:user) }
        .to have_enqueued_job(NewSignupAlertJob)
          .with { |user_id| expect(user_id).to eq(user.id) }
          .once
          .at(a_value_within(5.seconds).of(1.minute.from_now))
    end

    # The rest of a signup is authenticated requests against a row that already exists, and none of
    # them is news. `after_create_commit` is what makes that true even under the provisioning race:
    # the losing INSERT rolls its savepoint back and never commits, so its callback never fires.
    it "says nothing the second time the same admin is provisioned" do
      alert_phone("+447911123456")
      described_class.provision!(claims)

      expect { described_class.provision!(claims) }.not_to have_enqueued_job(NewSignupAlertJob)
    end

    it "enqueues nothing at all when no operator number is configured" do
      expect(Rails.configuration.x.sms.signup_alert_phone).to be_nil

      expect { described_class.provision!(claims) }.not_to have_enqueued_job(NewSignupAlertJob)
    end
  end

  # The fix for https://linear.app/bloombase/issue/BLO-1696: the operator console showed
  # "No name yet / Not provided" for the only real admin in production, because a token carries
  # neither claim and nothing else ever wrote the columns. Two callers now do — the sign-in callback
  # and `users:refresh_from_workos` — and they share this one rule.
  describe "#absorb_workos_identity!" do
    def identity(**attributes) = WorkosIdentity.new(**attributes)

    it "replaces a placeholder address with the real one" do
      user = create(:user, email: described_class.placeholder_email("user_01ALICE"))

      expect(user.absorb_workos_identity!(identity(email: "alice@example.com"))).to be(true)
      expect(user.reload.email).to eq("alice@example.com")
    end

    it "fills a name nothing had ever filled" do
      user = create(:user, name: nil)

      expect(user.absorb_workos_identity!(identity(first_name: "Alice", last_name: "Nkemdirim"))).to be(true)
      expect(user.reload.name).to eq("Alice Nkemdirim")
    end

    it "treats a name of whitespace as no name at all" do
      user = create(:user, name: "   ")

      user.absorb_workos_identity!(identity(first_name: "Alice"))

      expect(user.reload.name).to eq("Alice")
    end

    # The gap-filling rule, and the reason it is safe for this to be fed from a request body: the
    # body may name somebody nothing had named, and it may never rename them.
    it "never overwrites an address WorkOS already verified" do
      user = create(:user, email: "alice@example.com")

      expect(user.absorb_workos_identity!(identity(email: "impostor@example.com"))).to be(false)
      expect(user.reload.email).to eq("alice@example.com")
    end

    it "never overwrites a name that is already there" do
      user = create(:user, name: "Alice Nkemdirim")

      expect(user.absorb_workos_identity!(identity(first_name: "Somebody", last_name: "Else"))).to be(false)
      expect(user.reload.name).to eq("Alice Nkemdirim")
    end

    it "never replaces a fact with a blank" do
      user = create(:user, email: "alice@example.com", name: "Alice Nkemdirim")

      expect(user.absorb_workos_identity!(identity(email: "", first_name: " ", last_name: nil))).to be(false)
      expect(user.reload).to have_attributes(email: "alice@example.com", name: "Alice Nkemdirim")
    end

    # It runs on every sign-in, so the steady state has to cost no write at all.
    it "writes nothing at all the second time" do
      user = create(:user, email: described_class.placeholder_email("user_01ALICE"), name: nil)
      user.absorb_workos_identity!(identity(email: "alice@example.com", first_name: "Alice"))

      expect {
        expect(user.absorb_workos_identity!(identity(email: "alice@example.com", first_name: "Alice"))).to be(false)
      }.not_to change { user.reload.updated_at }
    end

    it "fills only the half that is missing" do
      user = create(:user, email: "alice@example.com", name: nil)

      expect(user.absorb_workos_identity!(identity(email: "other@example.com", first_name: "Alice"))).to be(true)
      expect(user.reload).to have_attributes(email: "alice@example.com", name: "Alice")
    end

    # `users.email` carries no unique index, and this is what stands in for one. An empty slot is
    # fillable by the request body, so without this a caller could post an address another admin
    # already holds and stand beside them under it on the operator console — which is the confusion
    # the whole gap-filling rule exists to prevent.
    it "refuses an address that already belongs to another user" do
      create(:user, email: "alice@example.com")
      other = create(:user, email: described_class.placeholder_email("user_01MALLORY"), name: "Mallory")

      expect(other.absorb_workos_identity!(identity(email: "alice@example.com"))).to be(false)
      expect(other.reload)
        .to have_attributes(email: described_class.placeholder_email("user_01MALLORY"), name: "Mallory")
    end

    # Refused, not raised: the sign-in carrying it still has to be recorded and the backfill still
    # has to reach the next row. The name was never anybody else's, so it is still filled.
    it "fills the name even when it had to refuse the address beside it" do
      create(:user, email: "alice@example.com")
      other = create(:user, email: described_class.placeholder_email("user_01MALLORY"), name: nil)

      expect(other.absorb_workos_identity!(identity(email: "alice@example.com", first_name: "Mallory"))).to be(true)
      expect(other.reload)
        .to have_attributes(email: described_class.placeholder_email("user_01MALLORY"), name: "Mallory")
    end
  end

  # What `users:refresh_from_workos` walks. Everything else is already as good as WorkOS could make
  # it, and asking about it would be a round trip for nothing.
  describe ".missing_workos_identity" do
    it "finds a placeholder address" do
      user = create(:user, email: described_class.placeholder_email("user_01ALICE"))

      expect(described_class.missing_workos_identity).to include(user)
    end

    it "finds a null name and a name of spaces alike" do
      null_name = create(:user, name: nil)
      blank_name = create(:user, name: "  ")

      expect(described_class.missing_workos_identity).to include(null_name, blank_name)
    end

    it "leaves alone a user WorkOS has already told us about" do
      complete = create(:user, email: "alice@example.com", name: "Alice Nkemdirim")

      expect(described_class.missing_workos_identity).not_to include(complete)
    end
  end

  it "reaches its groups through group_admins" do
    user = create(:user)
    group = create(:group)
    create(:group_admin, user: user, group: group)

    expect(user.groups).to contain_exactly(group)
  end
end
