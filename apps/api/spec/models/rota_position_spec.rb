require "rails_helper"

RSpec.describe RotaPosition do
  it "is valid with the factory" do
    expect(build(:rota_position)).to be_valid
  end

  describe "the running order" do
    it "refuses two members the same slot, because the rotation must be unambiguous" do
      existing = create(:rota_position)
      duplicate = build(:rota_position, rota: existing.rota, position: existing.position)

      expect(duplicate).not_to be_valid
      expect(duplicate.errors[:position]).to be_present
    end

    it "lets two rotas each have a first slot" do
      create(:rota_position, position: 0)

      expect(build(:rota_position, position: 0)).to be_valid
    end

    it "rejects a negative slot" do
      rota_position = build(:rota_position, position: -1)

      expect(rota_position).not_to be_valid
      expect(rota_position.errors[:position]).to be_present
    end
  end

  # The roster is an ordered *subset* of the group's members. Listing someone twice would quietly
  # give them two turns per cycle.
  it "refuses to put the same member on one rota twice" do
    existing = create(:rota_position)
    duplicate = build(:rota_position,
      rota: existing.rota, member: existing.member, position: existing.position + 1)

    expect(duplicate).not_to be_valid
    expect(duplicate.errors[:member_id]).to be_present
  end

  it "lets one member appear on several rotas, which is the whole point of the join table" do
    existing = create(:rota_position)
    other_rota = create(:rota, group: existing.rota.group)

    expect(build(:rota_position, rota: other_rota, member: existing.member)).to be_valid
  end

  # Tenancy, one level below the request: a stranger on the roster is a stranger we would text.
  it "refuses a member from another group" do
    rota_position = build(:rota_position, member: create(:member))

    expect(rota_position).not_to be_valid
    expect(rota_position.errors[:member]).to be_present
  end
end
