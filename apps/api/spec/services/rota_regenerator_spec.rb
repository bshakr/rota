require "rails_helper"

RSpec.describe RotaRegenerator do
  let(:now) { Time.utc(2026, 7, 13, 9, 0) }
  let(:today) { Date.new(2026, 7, 13) }
  let(:group) { create(:group, timezone: "Europe/London") }

  around { |example| travel_to(now) { example.run } }

  # A weekly rota, four members, anchored eight weeks back so it has real history as well as a
  # future. Generated up front, exactly as it would be when the admin first saved it.
  let(:rota) do
    create(:rota, :with_roster, roster_size: 4, group: group, starts_on: today - 8.weeks,
      interval_count: 1, interval_unit: "week").tap { |r| ShiftGenerator.new(r).call }
  end

  def shift_on(offset) = rota.shifts.find_by!(due_on: today + offset)

  describe "#roster_changed" do
    it "puts a new member into the future rotation" do
      dave = create(:member, group: group)
      create(:rota_position, rota: rota, member: dave, position: 4)

      described_class.new(rota.reload).roster_changed

      # Dave now takes every fifth turn. He was on none of them a moment ago.
      expect(rota.shifts.future(today).map(&:assigned_member)).to include(dave)
      expect(rota.shifts.where(due_on: ..today).map(&:assigned_member)).not_to include(dave)
    end

    it "follows a reorder — the running order IS rota_positions" do
      alice_slot, bob_slot = rota.rota_positions.order(:position).first(2)
      alice, bob = alice_slot.member, bob_slot.member
      before = rota.shifts.future(today).order(:due_on).first.assigned_member
      expect([ alice, bob ]).to include(before)

      # Swap the first two slots, parking one clear of the unique index on the way through.
      alice_slot.update!(position: 99)
      bob_slot.update!(position: 0)
      alice_slot.update!(position: 1)

      described_class.new(rota.reload).roster_changed

      after = rota.shifts.future(today).order(:due_on).first.assigned_member
      # The next turn belonged to one of the swapped pair. Now it belongs to the other.
      expect(after).to eq(before == alice ? bob : alice)
    end

    # The rule this whole ticket exists to protect.
    it "PRESERVES a covered future shift — Alice's arrangement with Bob survives adding Dave" do
      covered = shift_on(3.weeks)
      bob = create(:member, group: group)
      covered.update!(covering_member: bob)
      alice = covered.assigned_member

      create(:rota_position, rota: rota, member: create(:member, group: group), position: 4)
      described_class.new(rota.reload).roster_changed

      covered.reload
      expect(covered).to be_persisted
      expect(covered.covering_member).to eq(bob)
      # The whole row survives, assignee included — it is the record of an arrangement two people
      # actually made, not a slot in the new rotation.
      expect(covered.assigned_member).to eq(alice)
      expect(covered.responsible_member).to eq(bob)
    end

    it "regenerates the uncovered future shifts around a preserved one" do
      preserved = shift_on(3.weeks)
      preserved.update!(covering_member: create(:member, group: group))
      neighbour = shift_on(2.weeks)

      create(:rota_position, rota: rota, member: create(:member, group: group), position: 4)
      outcome = described_class.new(rota.reload).roster_changed

      expect(Shift.exists?(neighbour.id)).to be(false) # deleted and rebuilt as a new row
      expect(Shift.exists?(preserved.id)).to be(true)  # untouched
      expect(rota.shifts.find_by!(due_on: neighbour.due_on)).not_to eq(neighbour)
      expect(outcome.deleted).to eq(outcome.inserted) # same dates, new people
    end

    it "drops no covers, ever" do
      shift_on(2.weeks).update!(covering_member: create(:member, group: group))

      outcome = described_class.new(rota).roster_changed

      expect(outcome.dropped_covers).to be_empty
    end

    it "never touches a past shift" do
      historic = rota.shifts.order(:due_on).first
      before = historic.attributes

      create(:rota_position, rota: rota, member: create(:member, group: group), position: 4)
      described_class.new(rota.reload).roster_changed

      expect(historic.reload.attributes).to eq(before)
    end

    # Today's shift is on history's side of the line: its day-of reminder has gone out and the
    # member may already be doing the job.
    it "never touches today's shift" do
      todays = rota.shifts.find_by!(due_on: today)
      before = todays.attributes

      create(:rota_position, rota: rota, member: create(:member, group: group), position: 4)
      described_class.new(rota.reload).roster_changed

      expect(todays.reload.attributes).to eq(before)
    end

    it "leaves a rota emptied of its roster in draft, with its covers still standing" do
      covered = shift_on(2.weeks)
      covered.update!(covering_member: create(:member, group: group))
      rota.rota_positions.destroy_all

      described_class.new(rota.reload).roster_changed

      expect(rota).to be_draft
      expect(rota.shifts.future(today)).to contain_exactly(covered)
      expect(rota.shifts.where(due_on: ..today)).to be_present # history intact
    end
  end

  describe "#schedule_changed" do
    it "drops the covers, because the dates they were attached to no longer exist" do
      covered = shift_on(3.weeks)
      covered.update!(covering_member: create(:member, group: group))

      rota.update!(starts_on: today - 8.weeks + 2.days)
      outcome = described_class.new(rota).schedule_changed

      expect(Shift.exists?(covered.id)).to be(false)
      expect(outcome.dropped_covers.sole).to include(shift_id: covered.id, due_on: covered.due_on)
      expect(rota.shifts.future(today).covered).to be_empty
    end

    it "names who lost what, so the admin UI can say it out loud" do
      covered = shift_on(3.weeks)
      bob = create(:member, group: group)
      covered.update!(covering_member: bob)
      alice = covered.assigned_member

      rota.update!(interval_count: 2)
      dropped = described_class.new(rota).schedule_changed.dropped_covers.sole

      expect(dropped).to eq(
        shift_id: covered.id,
        due_on: covered.due_on,
        assigned_member_id: alice.id,
        assigned_member_name: alice.name,
        covering_member_id: bob.id,
        covering_member_name: bob.name
      )
    end

    it "rebuilds the whole future on the new dates" do
      rota.update!(interval_unit: "day", interval_count: 3)

      described_class.new(rota).schedule_changed

      gaps = rota.shifts.future(today).order(:due_on)
        .pluck(:due_on).each_cons(2).map { |a, b| (b - a).to_i }
      # Every future shift is three days from the next. Nothing weekly survives.
      expect(gaps.uniq).to eq([ 3 ])
    end

    it "never touches a past shift, even though its date is no longer in the series" do
      historic = rota.shifts.order(:due_on).first
      before = historic.attributes

      rota.update!(starts_on: today - 8.weeks + 1.day)
      described_class.new(rota).schedule_changed

      # Its due_on is now an orphan — no date in the new series lands on it — and it stays exactly
      # as it was anyway. It is the record of who actually cleaned that day.
      expect(historic.reload.attributes).to eq(before)
      expect(rota.shifts.where(due_on: ..today).count).to be >= 8
    end

    # sms_messages has a plain foreign key on shift_id with no cascade. A shift whose reminder has
    # already gone out cannot be deleted with `delete_all` — Postgres would refuse.
    it "takes the sent reminders of a deleted shift with it" do
      doomed = shift_on(1.week)
      create(:sms_message, :sent, shift: doomed, member: doomed.responsible_member)

      rota.update!(interval_count: 2)

      expect { described_class.new(rota).schedule_changed }.to change(SmsMessage, :count).by(-1)
    end
  end

  describe "#schedule_change_warning" do
    it "counts what is at stake and names the covers, without touching anything" do
      covered = shift_on(2.weeks)
      bob = create(:member, group: group)
      covered.update!(covering_member: bob)

      warning = described_class.new(rota).schedule_change_warning

      expect(warning[:future_shifts]).to eq(rota.shifts.future(today).count)
      expect(warning[:covers_dropped].sole).to include(
        shift_id: covered.id, covering_member_id: bob.id, covering_member_name: bob.name
      )
    end

    it "mutates nothing — it is what the admin sees BEFORE they confirm" do
      shift_on(2.weeks).update!(covering_member: create(:member, group: group))
      before = Shift.order(:id).pluck(:id, :due_on, :assigned_member_id, :covering_member_id)

      described_class.new(rota).schedule_change_warning

      expect(Shift.order(:id).pluck(:id, :due_on, :assigned_member_id, :covering_member_id))
        .to eq(before)
    end

    it "says there is nothing to lose when no cover has been arranged" do
      warning = described_class.new(rota).schedule_change_warning

      expect(warning[:covers_dropped]).to be_empty
      expect(warning[:future_shifts]).to be_positive
    end
  end
end
