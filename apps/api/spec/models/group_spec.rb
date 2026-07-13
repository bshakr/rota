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
