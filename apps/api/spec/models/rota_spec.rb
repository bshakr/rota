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

    it "requires each reminder to have a message template, reported against its position" do
      rota = build(:rota, reminders: [
        build(:rota_reminder, days_before: 3), build(:rota_reminder, days_before: 0, message_template: "")
      ])

      expect(rota).not_to be_valid
      expect(rota.errors[:"reminders[1].message_template"]).to be_present
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

  describe "reminders" do
    def rota_with(*timings)
      build(:rota, reminders: timings.map { |days| build(:rota_reminder, days_before: days) })
    end

    it "reads them furthest-out first, and in creation order within one timing" do
      rota = create(:rota, reminder_days: [ 0, 7, -1, 3, 3 ])

      expect(rota.reminders.reload.map(&:days_before)).to eq([ 7, 3, 3, 0, -1 ])
      expect(rota.reminders.select { |reminder| reminder.days_before == 3 }.map(&:id)).to eq(
        rota.reminders.select { |reminder| reminder.days_before == 3 }.map(&:id).sort
      )
    end

    it "allows the same timing twice, so two different texts can go out on one day" do
      expect(rota_with(3, 3)).to be_valid
    end

    it "accepts none, meaning the rota sends no reminders" do
      expect(create(:rota, reminder_days: []).reminders).to be_empty
    end

    it "accepts a day-of reminder, which is a timing of zero" do
      expect(rota_with(0)).to be_valid
    end

    it "accepts a reminder after the shift, down to two weeks after" do
      expect(rota_with(-1)).to be_valid
      expect(rota_with(-14)).to be_valid
    end

    it "rejects a timing more than two weeks after the shift, against its position" do
      rota = rota_with(3, -15)

      expect(rota).not_to be_valid
      expect(rota.errors[:"reminders[1].days_before"]).to be_present
    end

    it "rejects a timing more than a year before the shift" do
      expect(rota_with(366)).not_to be_valid
      expect(rota_with(365)).to be_valid
    end

    # Postgres casts "soon" to 0: a day-of reminder the admin never asked for.
    it "rejects a timing that is not a number, rather than silently reading it as day-of" do
      rota = rota_with(3, "soon")

      expect(rota).not_to be_valid
      expect(rota.errors[:"reminders[1].days_before"]).to be_present
    end

    it "accepts timings that arrive as strings, as they do over JSON" do
      expect(rota_with("3", "0")).to be_valid
    end

    it "allows ten and refuses an eleventh" do
      expect(rota_with(*Array.new(10, 0))).to be_valid

      rota = rota_with(*Array.new(11, 0))
      expect(rota).not_to be_valid
      expect(rota.errors[:reminders]).to be_present
    end
  end

  # Postgres hands an array column back as the literal "{3,0}", not as an Array, so a validation
  # that reads `_before_type_cast` sees a String the moment a rota is read from the database.
  # Without care that rejects every rota ever saved, and the rota editor cannot save a single
  # edit — while a suite that only ever builds fresh records stays perfectly green.
  describe "editing a rota that is already in the database" do
    let(:rota) { create(:rota, reminder_days: [ 3, 0 ]) }
    let(:reloaded) { described_class.find(rota.id) }
    let(:three_day) { rota.reminders.find { |reminder| reminder.days_before == 3 } }
    let(:day_of) { rota.reminders.find { |reminder| reminder.days_before == 0 } }

    it "is valid when read back" do
      expect(reloaded).to be_valid
    end

    it "can be renamed" do
      expect(reloaded.update(name: "Kitchen deep clean")).to be(true)
      expect(reloaded.reload.name).to eq("Kitchen deep clean")
    end

    it "keeps its reminders through an edit that does not touch them" do
      reloaded.update!(send_hour: 18)

      expect(reloaded.reminders.reload.map(&:id)).to eq([ three_day.id, day_of.id ])
    end

    it "replaces the whole list: updates by id, creates without one, destroys what is left out" do
      reloaded.replace_reminders([
        { id: three_day.id, days_before: 7, message_template: "Week out {{name}}" },
        { days_before: -1, message_template: "Thanks {{name}}" }
      ])
      reloaded.save!

      reminders = reloaded.reminders.reload
      expect(reminders.map(&:days_before)).to eq([ 7, -1 ])
      expect(reminders.first).to have_attributes(id: three_day.id, message_template: "Week out {{name}}")
      expect(RotaReminder.exists?(day_of.id)).to be(false)
    end

    it "removes every reminder for an empty list" do
      reloaded.replace_reminders([])
      reloaded.save!

      expect(reloaded.reminders.reload).to be_empty
    end

    it "refuses a reminder id that belongs to another rota, and changes nothing" do
      foreign = create(:rota).reminders.first
      reloaded.replace_reminders([
        { id: day_of.id, days_before: 0, message_template: "Today" },
        { id: foreign.id, days_before: 1, message_template: "Stolen" }
      ])

      expect(reloaded.save).to be(false)
      expect(reloaded.errors[:"reminders[1].id"]).to be_present
      expect(foreign.reload.message_template).not_to eq("Stolen")
      expect(RotaReminder.where(rota: rota).count).to eq(2)
    end

    it "reports errors by submitted position when updated, new and omitted reminders are mixed" do
      reloaded.replace_reminders([
        { days_before: 1, message_template: "New {{name}}" },
        { id: day_of.id, days_before: 0, message_template: "Hi {{nmae}}" },
        { days_before: "soon", message_template: "Also new" }
      ])

      expect(reloaded.save).to be(false)
      expect(reloaded.errors.attribute_names).to contain_exactly(
        :"reminders[1].message_template", :"reminders[2].days_before"
      )
      expect(RotaReminder.exists?(three_day.id)).to be(true)
    end

    it "still rejects a junk timing on an edit" do
      reloaded.replace_reminders([ { id: three_day.id, days_before: "soon", message_template: "x" } ])

      expect(reloaded.save).to be(false)
      expect(reloaded.errors[:"reminders[0].days_before"]).to be_present
    end

    # The previous release reads these columns; a rollback must find something it can send.
    it "mirrors the non-negative timings and the first reminder's text into the legacy columns" do
      reloaded.replace_reminders([
        { days_before: -1, message_template: "Thanks {{name}}" },
        { days_before: 2, message_template: "Soon {{name}}" },
        { days_before: 0, message_template: "Today {{name}}" }
      ])
      reloaded.save!

      expect(reloaded.reload).to have_attributes(reminder_offsets: [ 2, 0 ], message_template: "Soon {{name}}")
    end
  end

  describe "#cover_notice_template" do
    it "is the text of the furthest-out reminder before or on the shift's day" do
      rota = create(:rota, reminders: [
        build(:rota_reminder, days_before: -2, message_template: "Thanks"),
        build(:rota_reminder, days_before: 1, message_template: "Tomorrow")
      ])

      expect(rota.cover_notice_template).to eq("Tomorrow")
    end

    it "falls back to a fixed text when the rota sends no reminders" do
      expect(create(:rota, reminder_days: []).cover_notice_template).to eq(Rota::COVER_NOTICE_FALLBACK)
    end

    it "falls back to the fixed text rather than an after-shift text when every reminder is after the shift" do
      rota = create(:rota, reminders: [ build(:rota_reminder, days_before: -1, message_template: "Thanks {{name}}") ])

      expect(rota.cover_notice_template).to eq(Rota::COVER_NOTICE_FALLBACK)
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
