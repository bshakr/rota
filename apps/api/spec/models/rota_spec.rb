require "rails_helper"

RSpec.describe Rota do
  describe "validations" do
    it "is valid with the factory" do
      expect(build(:rota)).to be_valid
    end

    it "requires a name" do
      rota = build(:rota, name: "")

      expect(rota).not_to be_valid
      expect(rota.errors[:name]).to be_present
    end

    it "requires a message template" do
      rota = build(:rota, message_template: "")

      expect(rota).not_to be_valid
      expect(rota.errors[:message_template]).to be_present
    end

    it "requires an anchor date to count the series from" do
      rota = build(:rota, starts_on: nil)

      expect(rota).not_to be_valid
      expect(rota.errors[:starts_on]).to be_present
    end
  end

  describe "the schedule" do
    it "accepts each interval unit" do
      Rota::INTERVAL_UNITS.each do |unit|
        expect(build(:rota, interval_unit: unit)).to be_valid, "expected #{unit} to be accepted"
      end
    end

    it "rejects an interval unit the shift generator cannot count in" do
      rota = build(:rota, interval_unit: "fortnight")

      expect(rota).not_to be_valid
      expect(rota.errors[:interval_unit]).to be_present
    end

    it "rejects an interval count of zero, which would be a series of one day forever" do
      rota = build(:rota, interval_count: 0)

      expect(rota).not_to be_valid
      expect(rota.errors[:interval_count]).to be_present
    end

    it "rejects a negative interval count" do
      expect(build(:rota, interval_count: -1)).not_to be_valid
    end

    it "accepts every hour of the day" do
      expect(build(:rota, send_hour: 0)).to be_valid
      expect(build(:rota, send_hour: 23)).to be_valid
    end

    it "rejects an hour that is not on the clock" do
      expect(build(:rota, send_hour: 24)).not_to be_valid
      expect(build(:rota, send_hour: -1)).not_to be_valid
    end

    # Postgres integer columns coerce rather than complain: "abc" becomes 0, which is a perfectly
    # legal send_hour. Without a numericality check, a typo would silently move the rota to
    # midnight.
    it "rejects an hour that is not a number at all" do
      rota = build(:rota, send_hour: "midnight-ish")

      expect(rota).not_to be_valid
      expect(rota.errors[:send_hour]).to be_present
    end
  end

  describe "reminder offsets" do
    it "stores them sorted descending, furthest-out reminder first" do
      expect(create(:rota, reminder_offsets: [ 0, 7, 3 ]).reminder_offsets).to eq([ 7, 3, 0 ])
    end

    it "accepts them already sorted" do
      expect(create(:rota, reminder_offsets: [ 3, 0 ]).reminder_offsets).to eq([ 3, 0 ])
    end

    it "collapses a repeated offset rather than sending the same text twice" do
      expect(create(:rota, reminder_offsets: [ 3, 3, 0 ]).reminder_offsets).to eq([ 3, 0 ])
    end

    it "accepts an empty list, meaning the rota sends no reminders" do
      expect(create(:rota, reminder_offsets: []).reminder_offsets).to eq([])
    end

    it "accepts a day-of reminder, which is simply an offset of zero" do
      expect(create(:rota, reminder_offsets: [ 0 ]).reminder_offsets).to eq([ 0 ])
    end

    it "rejects a negative offset, which would fall after the shift" do
      rota = build(:rota, reminder_offsets: [ 3, -1 ])

      expect(rota).not_to be_valid
      expect(rota.errors[:reminder_offsets]).to be_present
    end

    # The dangerous one. Postgres casts "soon" to 0 — a day-of reminder the admin never asked for
    # and cannot see they created. The raw value is the only place that difference survives.
    it "rejects an offset that is not a number, rather than silently reading it as day-of" do
      rota = build(:rota, reminder_offsets: [ "3", "soon" ])

      expect(rota).not_to be_valid
      expect(rota.errors[:reminder_offsets]).to be_present
    end

    it "accepts numeric offsets that arrive as strings, as they do over JSON" do
      expect(create(:rota, reminder_offsets: [ "3", "0" ]).reminder_offsets).to eq([ 3, 0 ])
    end
  end

  # Postgres hands an array column back as the literal "{3,0}", not as an Array, so a validation
  # that reads `_before_type_cast` sees a String the moment a rota is read from the database.
  # Without care that rejects every rota ever saved, and the rota editor cannot save a single
  # edit — while a suite that only ever builds fresh records stays perfectly green.
  describe "editing a rota that is already in the database" do
    let(:rota) { create(:rota, reminder_offsets: [ 3, 0 ]) }

    it "is valid when read back" do
      expect(described_class.find(rota.id)).to be_valid
    end

    it "can be renamed" do
      reloaded = described_class.find(rota.id)

      expect(reloaded.update(name: "Kitchen deep clean")).to be(true)
      expect(reloaded.reload.name).to eq("Kitchen deep clean")
    end

    it "keeps its offsets through an edit that does not touch them" do
      reloaded = described_class.find(rota.id)
      reloaded.update!(send_hour: 18)

      expect(reloaded.reload.reminder_offsets).to eq([ 3, 0 ])
    end

    it "can have its offsets changed" do
      reloaded = described_class.find(rota.id)
      reloaded.update!(reminder_offsets: [ 0, 7 ])

      expect(reloaded.reload.reminder_offsets).to eq([ 7, 0 ])
    end

    it "still rejects junk offsets on an edit" do
      reloaded = described_class.find(rota.id)

      expect(reloaded.update(reminder_offsets: [ "soon" ])).to be(false)
      expect(reloaded.errors[:reminder_offsets]).to be_present
    end
  end

  # Draft is derived from the roster, never stored: there is no way for a flag and a roster to
  # disagree if the flag does not exist.
  describe "#draft?" do
    it "is true for a rota with nobody on it, because there is nobody to assign" do
      expect(create(:rota)).to be_draft
    end

    it "is false once the rota has a roster" do
      expect(create(:rota, :with_roster)).not_to be_draft
    end

    it "goes back to true when the last member is taken off" do
      rota = create(:rota, :with_roster, roster_size: 1)

      rota.rota_positions.destroy_all

      expect(rota.reload).to be_draft
    end
  end

  describe "associations" do
    it "reads its roster in running order, which is what makes the rotation a rotation" do
      rota = create(:rota)
      third = create(:rota_position, rota: rota, position: 2)
      first = create(:rota_position, rota: rota, position: 0)
      second = create(:rota_position, rota: rota, position: 1)

      expect(rota.rota_positions.reload.to_a).to eq([ first, second, third ])
    end

    it "takes its shifts with it when destroyed" do
      shift = create(:shift)

      expect { shift.rota.destroy! }.to change(described_class, :count).by(-1)
      expect(Shift.exists?(shift.id)).to be(false)
    end
  end

  describe ".active" do
    it "takes only the active rotas, which are the only ones the sweep looks at" do
      group = create(:group)
      active = create(:rota, group: group)
      create(:rota, :inactive, group: group)

      expect(group.rotas.active).to contain_exactly(active)
    end
  end
end
