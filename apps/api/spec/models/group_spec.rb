require "rails_helper"

RSpec.describe Group do
  describe "validations" do
    it "is valid with the factory" do
      expect(build(:group)).to be_valid
    end

    it "requires a name" do
      group = build(:group, name: "")

      expect(group).not_to be_valid
      expect(group.errors[:name]).to be_present
    end

    it "requires a WorkOS organization to map onto" do
      group = build(:group, workos_organization_id: nil)

      expect(group).not_to be_valid
      expect(group.errors[:workos_organization_id]).to be_present
    end

    it "refuses two groups for the same WorkOS organization" do
      create(:group, workos_organization_id: "org_taken")
      duplicate = build(:group, workos_organization_id: "org_taken")

      expect(duplicate).not_to be_valid
      expect(duplicate.errors[:workos_organization_id]).to be_present
    end
  end

  # The group's timezone is what the reminder sweep reads send_hour in, so a nonsense value would
  # not fail loudly — it would just send at the wrong time, or not at all.
  describe "timezone" do
    it "accepts an IANA identifier" do
      expect(build(:group, timezone: "Europe/London")).to be_valid
    end

    it "accepts a Rails zone name" do
      expect(build(:group, timezone: "London")).to be_valid
    end

    it "requires one" do
      group = build(:group, timezone: "")

      expect(group).not_to be_valid
      expect(group.errors[:timezone]).to be_present
    end

    it "rejects a zone nobody has heard of" do
      group = build(:group, timezone: "Middle/Earth")

      expect(group).not_to be_valid
      expect(group.errors[:timezone]).to include("is not a recognised time zone")
    end

    it "hands back a real TimeZone to compute send times in" do
      group = build(:group, timezone: "Europe/London")

      expect(group.time_zone).to be_a(ActiveSupport::TimeZone)
      expect(group.time_zone.tzinfo.identifier).to eq("Europe/London")
    end
  end

  # The whole point of #today: UTC gets "what day is it in this house?" wrong in both directions,
  # and both wrong answers move a real person's chore.
  describe "#today" do
    it "has already turned over for a group east of the server" do
      group = build(:group, timezone: "Pacific/Auckland")

      # 23:00 UTC on the 13th is noon on the 14th in Auckland. A shift due on the 14th is today's
      # there — already texted about, possibly already being done — and must not be treated as a
      # disposable future row.
      travel_to Time.utc(2026, 7, 13, 23, 0) do
        expect(Date.current).to eq(Date.new(2026, 7, 13))
        expect(group.today).to eq(Date.new(2026, 7, 14))
      end
    end

    it "has not yet turned over for a group west of the server" do
      group = build(:group, timezone: "Pacific/Honolulu")

      # 02:00 UTC on the 13th is 16:00 on the 12th in Honolulu. A shift due on the 13th is still a
      # day away there, its day-of reminder unsent, and a config change should still be free to
      # reassign it.
      travel_to Time.utc(2026, 7, 13, 2, 0) do
        expect(Date.current).to eq(Date.new(2026, 7, 13))
        expect(group.today).to eq(Date.new(2026, 7, 12))
      end
    end
  end

  describe "#timezone_confirmed?" do
    # NULL means "we guessed" — the timezone came from a JIT insert, not a human. A group is only
    # confirmed once someone stamps timezone_confirmed_at (BLO-1047's settings API).
    it "is false while timezone_confirmed_at is NULL" do
      expect(build(:group, timezone_confirmed_at: nil).timezone_confirmed?).to be(false)
    end

    it "is true once a human has confirmed the timezone" do
      expect(build(:group, timezone_confirmed_at: Time.current).timezone_confirmed?).to be(true)
    end
  end

  # What a house is called between being provisioned from a WorkOS token and an admin naming it.
  # NewSignupAlertJob reads this so an operator's signup text says "not named yet" rather than a
  # WorkOS organization id.
  describe "#placeholder_name?" do
    it "is true for the name GroupAdmin.provision! gives a brand new house" do
      group = create(:group, workos_organization_id: "org_01FLAT", name: described_class.placeholder_name("org_01FLAT"))

      expect(group.placeholder_name?).to be(true)
    end

    it "is false once somebody has named the house" do
      expect(create(:group, name: "The Beeches").placeholder_name?).to be(false)
    end
  end

  # BLO-1675. The flag itself; what reading it does to the rest of the app is
  # spec/requests/suspended_house_spec.rb and the three recurring job specs.
  describe "suspension" do
    let(:group) { create(:group) }

    it "is live until somebody suspends it" do
      expect(group.suspended?).to be(false)
      expect(described_class.live).to include(group)
    end

    it "drops out of `live` once suspended, and comes back on resume" do
      group.suspend!

      expect(group.suspended?).to be(true)
      expect(described_class.live).not_to include(group)

      group.resume!

      expect(group.reload.suspended_at).to be_nil
      expect(described_class.live).to include(group)
    end

    # A second POST is a retry, a double-click or a second operator on the same button. Moving
    # "paused since" would rewrite the one fact anyone asks about a paused house.
    it "does not move the moment it was paused when suspended twice" do
      paused_at = travel_to(3.days.ago) { group.suspend!; group.reload.suspended_at }

      expect { group.suspend! }.not_to change { group.reload.suspended_at }
      expect(group.reload.suspended_at).to be_within(1.second).of(paused_at)
    end

    it "answers whether it actually changed anything" do
      expect(group.suspend!).to be(true)
      expect(group.suspend!).to be(false)
      expect(group.resume!).to be(true)
      expect(group.resume!).to be(false)
    end

    # The audit trail for an operator action is a log line naming their verified WorkOS `sub`.
    # There is no row for a super admin — the allowlist is an environment variable — so this line
    # is the whole of it, and a suspension that did not say who did it would not be an audit.
    describe "the line it writes to the log" do
      # A `before`, not an `around`: the suite resets Current in a global before hook (see
      # spec/support/workos_auth.rb), which an around hook would run before and be undone by.
      before { Current.super_admin_workos_user_id = "user_01OPERATOR" }

      it "names the operator, the house and what was done" do
        allow(Rails.logger).to receive(:info)

        group.suspend!

        expect(Rails.logger).to have_received(:info)
          .with(/user_01OPERATOR suspended: group #{group.id} \(#{group.slug}\)/)
      end

      it "names the operator on resume too" do
        group.suspend!
        allow(Rails.logger).to receive(:info)

        group.resume!

        expect(Rails.logger).to have_received(:info).with(/user_01OPERATOR resumed: group #{group.id}/)
      end

      # The no-op is written down as well. "Suspend this house" was asked for either way, and an
      # operator who clicked twice should find both requests in the log rather than one of them
      # silently missing.
      it "records a request that changed nothing, and says so" do
        group.suspend!
        allow(Rails.logger).to receive(:info)

        group.suspend!

        expect(Rails.logger).to have_received(:info).with(/re-suspended a house that was already paused/)
      end
    end

    # Suspension is the abuse-and-cost lever, reached for when a house is doing something that has to
    # stop NOW. A `save` would validate the whole record, so any unrelated bad value — a timezone a
    # tzdata update no longer recognises, here written past the validation the way a migration or a
    # bad backfill would — could refuse to let the operator pause the house at all.
    describe "a house whose record would not otherwise validate" do
      before { group.update_column(:timezone, "Mars/Olympus") }

      it "can still be paused" do
        expect(group).not_to be_valid

        expect(group.suspend!).to be(true)
        expect(group.reload.suspended_at).to be_present
      end

      it "can still be let go again" do
        group.suspend!

        expect(group.resume!).to be(true)
        expect(group.reload.suspended_at).to be_nil
      end

      # Skipping validation is not licence to skip the bookkeeping: a paused house whose row looks
      # untouched would be its own small lie.
      it "still stamps updated_at" do
        expect { group.suspend! }.to change { group.reload.updated_at }
      end
    end

    # A note is rendered in full on the group page, and a column with no ceiling is one somebody
    # eventually pastes a log file into. Same precedent as Rota#message_template.
    it "refuses a note longer than the ceiling" do
      group.notes = "x" * (described_class::NOTES_MAX + 1)

      expect(group).not_to be_valid
      expect(group.errors[:notes]).to be_present
    end

    it "is happy with no note at all, and with one right up to the ceiling" do
      expect(build(:group, notes: nil)).to be_valid
      expect(build(:group, notes: "x" * described_class::NOTES_MAX)).to be_valid
    end

    it "says so plainly when nothing named the operator" do
      allow(Rails.logger).to receive(:info)

      group.suspend!

      expect(Rails.logger).to have_received(:info).with(/an unidentified caller suspended/)
    end
  end

  describe "destroying" do
    # Members cannot be destroyed while a shift still names them, so the group has to clear its
    # rotas — and therefore their shifts — before it can clear its members. That ordering is
    # declared in the model, and this is what holds it in place.
    it "clears its rotas, shifts and members together" do
      rota = create(:rota, :with_roster)
      create(:shift, rota: rota, assigned_member: rota.members.first)
      group = rota.group

      expect { group.destroy! }
        .to change(described_class, :count).by(-1)
        .and change(Rota, :count).by(-1)
        .and change(Shift, :count).by(-1)
        .and change(Member, :count).by(-3)
        .and change(RotaPosition, :count).by(-3)
    end
  end
end
