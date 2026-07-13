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
