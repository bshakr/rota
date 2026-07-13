require "rails_helper"

RSpec.describe MemberRemoval do
  let(:group) { create(:group) }

  def rostered_rota(size:)
    rota = create(:rota, :with_roster, group: group, roster_size: size,
      starts_on: group.today, interval_unit: "day", interval_count: 1)
    ShiftGenerator.new(rota).call
    rota
  end

  it "deactivates the member without destroying them" do
    member = create(:member, group: group)

    result = described_class.new(member).call

    expect(member.reload.active).to be(false)
    expect(result.reassigned).to eq([])
    expect(result.dropped_covers).to eq([])
  end

  it "removes the member from every rota's roster" do
    rota = rostered_rota(size: 3)
    member = rota.rota_positions.order(:position).first.member

    described_class.new(member).call

    expect(rota.reload.rota_positions.map(&:member_id)).not_to include(member.id)
  end

  it "reassigns the departing member's future turns to whoever now holds them" do
    rota = rostered_rota(size: 3)
    member = rota.rota_positions.order(:position).first.member

    reassigned = described_class.new(member).call.reassigned

    expect(reassigned).to be_present
    reassigned.each do |entry|
      shift = rota.reload.shifts.find_by(due_on: entry[:due_on])
      expect(entry[:now_assigned_member_id]).to eq(shift.responsible_member.id)
      expect(entry[:now_assigned_member_id]).not_to eq(member.id)
    end
  end

  # When the leaver was the rota's only person, there is no one left to take the turn: the rota falls
  # to draft, its future shifts vanish, and the enumeration says so honestly rather than inventing an
  # assignee.
  it "reports no new assignee when removing the rota's last member drops it to draft" do
    rota = rostered_rota(size: 1)
    member = rota.rota_positions.sole.member

    reassigned = described_class.new(member).call.reassigned

    expect(rota.reload).to be_draft
    expect(reassigned).to be_present
    expect(reassigned.map { |entry| entry[:now_assigned_member_id] }).to all(be_nil)
  end

  it "leaves past shifts untouched — history is not rewritten" do
    rota = create(:rota, :with_roster, group: group, roster_size: 2,
      starts_on: 30.days.ago.to_date, interval_unit: "day", interval_count: 1)
    ShiftGenerator.new(rota).call
    member = rota.rota_positions.order(:position).first.member
    past = rota.shifts.where(assigned_member_id: member.id).where(shifts: { due_on: ..group.today }).to_a
    expect(past).to be_present

    described_class.new(member).call

    past.each { |shift| expect(shift.reload.assigned_member_id).to eq(member.id) }
  end
end
