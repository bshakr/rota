require "rails_helper"
require Rails.root.join("db/migrate/20261008120000_create_rota_reminders")

# Runs the migration's backfill SQL against rows shaped the way the previous release left them:
# offsets and one template on the rota, texts keyed by timing alone.
RSpec.describe CreateRotaReminders do
  let(:connection) { ActiveRecord::Base.connection }

  def legacy_rota(offsets:, template:)
    rota = create(:rota, reminder_days: [])
    rota.update_columns(reminder_offsets: offsets, message_template: template)
    rota
  end

  def legacy_text(shift, days_before)
    create(:sms_message, shift: shift, days_before: days_before).tap do |message|
      message.update_column(:rota_reminder_id, nil)
    end
  end

  it "gives each rota one reminder per offset, carrying the rota's template" do
    kitchen = legacy_rota(offsets: [ 3, 0 ], template: "Kitchen {{name}}")
    bins = legacy_rota(offsets: [ 1 ], template: "Bins {{name}}")
    quiet = legacy_rota(offsets: [], template: "Never sent")

    connection.execute(described_class::BACKFILL_REMINDERS)

    expect(kitchen.reminders.reload.map { |r| [ r.days_before, r.message_template ] })
      .to eq([ [ 3, "Kitchen {{name}}" ], [ 0, "Kitchen {{name}}" ] ])
    expect(bins.reminders.reload.map { |r| [ r.days_before, r.message_template ] }).to eq([ [ 1, "Bins {{name}}" ] ])
    expect(quiet.reminders.reload).to be_empty
  end

  it "collapses a repeated offset rather than creating two reminders that would both send" do
    rota = legacy_rota(offsets: [ 3, 3 ], template: "Hi")

    connection.execute(described_class::BACKFILL_REMINDERS)

    expect(rota.reminders.reload.map(&:days_before)).to eq([ 3 ])
  end

  it "links each sent reminder to the reminder at its timing, and leaves the rest alone" do
    rota = legacy_rota(offsets: [ 3, 0 ], template: "Hi {{name}}")
    shift = create(:shift, rota: rota)
    three_day = legacy_text(shift, 3)
    day_of = legacy_text(shift, 0)
    retired = legacy_text(shift, 7)
    cover = create(:sms_message, :cover_notice, shift: shift)

    connection.execute(described_class::BACKFILL_REMINDERS)
    connection.execute(described_class::LINK_REMINDER_TEXTS)

    reminders = rota.reminders.reload.index_by(&:days_before)
    expect(three_day.reload.rota_reminder_id).to eq(reminders.fetch(3).id)
    expect(day_of.reload.rota_reminder_id).to eq(reminders.fetch(0).id)
    expect(retired.reload.rota_reminder_id).to be_nil
    expect(cover.reload.rota_reminder_id).to be_nil
  end

  it "never links a text to another rota's reminder at the same timing" do
    mine = legacy_rota(offsets: [ 3 ], template: "Mine")
    theirs = legacy_rota(offsets: [ 3 ], template: "Theirs")
    text = legacy_text(create(:shift, rota: mine), 3)

    connection.execute(described_class::BACKFILL_REMINDERS)
    connection.execute(described_class::LINK_REMINDER_TEXTS)

    expect(text.reload.rota_reminder).to eq(mine.reminders.reload.sole)
    expect(theirs.reminders.reload.sole.sms_messages).to be_empty
  end
  # The previous API capped offsets only in the web form, so a rota may hold one above the app's
  # 365. The backfill must carry it rather than fail the deploy.
  it "backfills an offset above the app's limit instead of refusing the deploy" do
    rota = legacy_rota(offsets: [ 400, 0 ], template: "Hi")

    connection.execute(described_class::BACKFILL_REMINDERS)

    expect(rota.reminders.reload.map(&:days_before)).to eq([ 400, 0 ])
  end
end
