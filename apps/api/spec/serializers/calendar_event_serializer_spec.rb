require "rails_helper"

# The split between these two serializers is a privacy boundary, not a display option (spec section
# 13): members receive title, dates, kind and member ids, and nothing else the model said. This file
# is what stops a later "just add reason, it's useful" from crossing it by accident.
RSpec.describe CalendarEventSerializer do
  let(:group) { create(:group, timezone: "Europe/London") }
  let(:connection) { create(:calendar_connection, group: group) }
  let(:member) { create(:member, group: group, name: "Alfie") }
  let(:event) do
    create(:calendar_event, calendar_connection: connection, summary: "Alfie in Greece", kind: "away",
                            reason: "Alfie, six nights in Greece",
                            starts_on: Date.new(2026, 9, 25), ends_on: Date.new(2026, 10, 1)).tap do |record|
      record.members << member
    end
  end

  it "gives the member exactly the four facts and no verdict" do
    expect(described_class.one(event)).to eq(
      id: event.id, title: "Alfie in Greece", starts_on: "2026-09-25", ends_on: "2026-10-01",
      all_day: true, start_time: nil, kind: "away", member_ids: [ member.id ]
    )
  end

  it "never carries the model's reason" do
    expect(described_class.one(event)).not_to have_key(:reason)
  end

  it "renders a timed event's wall clock in the house's zone" do
    timed = create(:calendar_event, calendar_connection: connection, summary: "House dinner", all_day: false,
                                    starts_on: Date.new(2026, 9, 20), ends_on: Date.new(2026, 9, 20),
                                    starts_at: Time.utc(2026, 9, 20, 18, 0), ends_at: Time.utc(2026, 9, 20, 20, 0))

    expect(described_class.one(timed)).to include(all_day: false, start_time: "19:00")
  end

  describe CalendarEventPreviewSerializer do
    it "adds the reason the admin needs to check a verdict, and nothing else" do
      expect(described_class.one(event)).to eq(CalendarEventSerializer.one(event).merge(reason: "Alfie, six nights in Greece"))
    end

    it "carries a null reason while the verdict is still pending" do
      pending_event = create(:calendar_event, calendar_connection: connection, classified_at: nil, reason: nil)

      expect(described_class.one(pending_event)).to include(kind: "event", reason: nil, member_ids: [])
    end
  end
end
