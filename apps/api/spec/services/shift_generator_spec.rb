require "rails_helper"

RSpec.describe ShiftGenerator do
  # A fixed "now" everywhere, because every assertion below is a date. Europe/London in July is
  # BST (UTC+1), so 09:00 UTC is 10:00 in the house and the two calendars agree on the date — the
  # timezone edges get their own section at the bottom.
  let(:now) { Time.utc(2026, 7, 13, 9, 0) }
  let(:today) { Date.new(2026, 7, 13) }
  let(:group) { create(:group, timezone: "Europe/London") }

  around { |example| travel_to(now) { example.run } }

  def roster(rota) = rota.rota_positions.map(&:member)

  def due_dates(rota) = rota.shifts.order(:due_on).pluck(:due_on)

  describe "the series" do
    it "generates weekly shifts from the anchor date" do
      rota = create(:rota, :with_roster, group: group, starts_on: today,
        interval_count: 1, interval_unit: "week")

      described_class.new(rota).call

      expect(due_dates(rota).first(3))
        .to eq([ today, today + 1.week, today + 2.weeks ])
    end

    it "generates fortnightly shifts" do
      rota = create(:rota, :with_roster, group: group, starts_on: today,
        interval_count: 2, interval_unit: "week")

      described_class.new(rota).call

      expect(due_dates(rota).first(3))
        .to eq([ today, today + 2.weeks, today + 4.weeks ])
    end

    it "generates monthly shifts" do
      rota = create(:rota, :with_roster, group: group, starts_on: today,
        interval_count: 1, interval_unit: "month")

      described_class.new(rota).call

      # Three, not four: the fourth would fall on 13 Oct and the window closes on 11 Oct.
      expect(due_dates(rota))
        .to eq([ today, today + 1.month, today + 2.months ])
    end

    it "generates every-3-days shifts" do
      rota = create(:rota, :with_roster, group: group, starts_on: today,
        interval_count: 3, interval_unit: "day")

      described_class.new(rota).call

      expect(due_dates(rota).first(3))
        .to eq([ today, today + 3.days, today + 6.days ])
    end

    it "fills the window to 90 days out and no further" do
      rota = create(:rota, :with_roster, group: group, starts_on: today,
        interval_count: 1, interval_unit: "day")

      described_class.new(rota).call

      expect(due_dates(rota).last).to eq(today + 90.days)
      expect(rota.shifts.count).to eq(91) # today plus ninety
    end

    it "does nothing for a rota that has not started yet" do
      rota = create(:rota, :with_roster, group: group, starts_on: today + 1.year)

      expect { described_class.new(rota).call }.not_to change(Shift, :count)
    end

    # Intended, and stated in the spec: the sweep's staleness guard buries anything more than 24h
    # overdue, so backfilled history never texts anyone.
    it "backfills history rows when the anchor date is in the past" do
      rota = create(:rota, :with_roster, group: group, starts_on: today - 3.weeks,
        interval_count: 1, interval_unit: "week")

      described_class.new(rota).call

      expect(due_dates(rota).first).to eq(today - 3.weeks)
      expect(rota.shifts.where(due_on: ...today).count).to eq(3)
    end
  end

  # Each date is computed from `starts_on`, never from its predecessor. Stepping month-by-month
  # would land on 28 Mar; anchoring on the 31st lands on 31 Mar, which is the date the admin
  # actually asked for.
  describe "month-end arithmetic" do
    context "on the 31st of January" do
      let(:now) { Time.utc(2026, 1, 31, 9, 0) }

      it "clamps 31 Jan + 1 month to 28 Feb, then returns to the 31st" do
        rota = create(:rota, :with_roster, group: group, starts_on: Date.new(2026, 1, 31),
          interval_count: 1, interval_unit: "month")

        described_class.new(rota).call

        expect(due_dates(rota)).to eq([
          Date.new(2026, 1, 31),
          Date.new(2026, 2, 28), # clamped — 2026 is not a leap year
          Date.new(2026, 3, 31), # and back out to the 31st, not stuck on the 28th
          Date.new(2026, 4, 30)
        ])
      end
    end

    context "on the 31st of January in a leap year" do
      let(:now) { Time.utc(2028, 1, 31, 9, 0) }

      it "clamps to 29 Feb" do
        rota = create(:rota, :with_roster, group: group, starts_on: Date.new(2028, 1, 31),
          interval_count: 1, interval_unit: "month")

        described_class.new(rota).call

        expect(due_dates(rota).second).to eq(Date.new(2028, 2, 29))
      end
    end
  end

  describe "the rotation" do
    it "wraps the roster round and round: positions[i % positions.count]" do
      rota = create(:rota, :with_roster, roster_size: 4, group: group, starts_on: today,
        interval_count: 1, interval_unit: "week")
      alice, bob, cara, dave = roster(rota)

      described_class.new(rota).call

      # A full cycle and a half: four turns each, then round again.
      expect(rota.shifts.order(:due_on).limit(6).map(&:assigned_member))
        .to eq([ alice, bob, cara, dave, alice, bob ])
    end

    it "follows position, not member id or creation order" do
      rota = create(:rota, group: group, starts_on: today, interval_count: 1, interval_unit: "week")
      first_created = create(:member, group: group)
      second_created = create(:member, group: group)
      # Second-created member is put at the front of the running order.
      create(:rota_position, rota: rota, member: second_created, position: 0)
      create(:rota_position, rota: rota, member: first_created, position: 1)

      described_class.new(rota.reload).call

      expect(rota.shifts.order(:due_on).first.assigned_member).to eq(second_created)
    end

    it "puts a single-member roster on every shift" do
      rota = create(:rota, :with_roster, roster_size: 1, group: group, starts_on: today)
      only = roster(rota).sole

      described_class.new(rota).call

      expect(rota.shifts.map(&:assigned_member).uniq).to eq([ only ])
    end
  end

  describe "a draft rota" do
    it "generates nothing and raises nothing" do
      rota = create(:rota, group: group, starts_on: today)

      expect(rota).to be_draft
      expect { described_class.new(rota).call }.not_to raise_error
      expect(rota.shifts).to be_empty
    end

    it "reports that it inserted nothing" do
      rota = create(:rota, group: group, starts_on: today)

      expect(described_class.new(rota).call).to eq(0)
    end
  end

  # The heart of the immutable-history guarantee. `insert_all` with `unique_by` is ON CONFLICT DO
  # NOTHING; an upsert here would rewrite last month's assignee and quietly destroy the record of
  # who actually cleaned.
  describe "running twice" do
    it "creates no duplicates" do
      rota = create(:rota, :with_roster, group: group, starts_on: today)

      described_class.new(rota).call

      expect { described_class.new(rota).call }.not_to change(Shift, :count)
    end

    it "reports that the second run inserted nothing" do
      rota = create(:rota, :with_roster, group: group, starts_on: today)
      described_class.new(rota).call

      expect(described_class.new(rota).call).to eq(0)
    end

    it "MUTATES NOTHING — not one column of one row" do
      rota = create(:rota, :with_roster, group: group, starts_on: today - 8.weeks)
      described_class.new(rota).call
      before = Shift.order(:id).pluck(:id, :rota_id, :due_on, :assigned_member_id,
        :covering_member_id, :created_at, :updated_at)

      travel 1.hour
      described_class.new(rota).call

      after = Shift.order(:id).pluck(:id, :rota_id, :due_on, :assigned_member_id,
        :covering_member_id, :created_at, :updated_at)
      expect(after).to eq(before)
    end

    # The scenario the ON CONFLICT clause exists for. Reorder the roster without regenerating —
    # generation alone must not be able to reach back and rewrite who cleaned.
    it "never rewrites a past shift's assignee, even when the roster has changed under it" do
      rota = create(:rota, :with_roster, roster_size: 2, group: group,
        starts_on: today - 4.weeks, interval_count: 1, interval_unit: "week")
      described_class.new(rota).call
      historic = rota.shifts.order(:due_on).first
      who_actually_cleaned = historic.assigned_member

      # Swap the running order. The series is unchanged; only the people move.
      rota.rota_positions.order(:position).to_a.tap do |positions|
        positions.first.update!(position: 99)
        positions.second.update!(position: 0)
        positions.first.update!(position: 1)
      end

      described_class.new(rota.reload).call

      expect(historic.reload.assigned_member).to eq(who_actually_cleaned)
    end

    it "leaves a cover on an existing shift alone" do
      rota = create(:rota, :with_roster, group: group, starts_on: today)
      described_class.new(rota).call
      covered = rota.shifts.order(:due_on).second
      covered.update!(covering_member: create(:member, group: group))

      described_class.new(rota).call

      expect(covered.reload).to be_covered
    end

    # Generation only ever adds. If regeneration (or anything else) has left a hole in the series,
    # the next run fills it — which is what makes the daily job a reconciliation loop rather than
    # a one-shot.
    it "fills a hole punched in the middle of the series" do
      rota = create(:rota, :with_roster, group: group, starts_on: today)
      described_class.new(rota).call
      missing = rota.shifts.order(:due_on).third
      due_on = missing.due_on
      missing.destroy!

      expect { described_class.new(rota).call }.to change(Shift, :count).by(1)
      expect(rota.shifts.exists?(due_on: due_on)).to be(true)
    end
  end

  describe "the window's far edge" do
    # 23:00 UTC on the 13th: UTC still says the 13th, Auckland already says the 14th.
    let(:now) { Time.utc(2026, 7, 13, 23, 0) }

    # The horizon is 90 days from the group's own today, not the server's. Get this wrong and a
    # rota runs one shift short of its window or one past it — harmless on its own, but it is the
    # same date the regeneration cut-off is built on, where it is not harmless at all.
    it "is measured from the group's calendar, not UTC" do
      auckland = create(:group, timezone: "Pacific/Auckland")
      rota = create(:rota, :with_roster, group: auckland, starts_on: Date.new(2026, 7, 14),
        interval_count: 1, interval_unit: "day")

      described_class.new(rota).call

      expect(Date.current).to eq(Date.new(2026, 7, 13))
      expect(rota.group.today).to eq(Date.new(2026, 7, 14))
      expect(due_dates(rota).last).to eq(Date.new(2026, 7, 14) + 90.days)
    end
  end
end
