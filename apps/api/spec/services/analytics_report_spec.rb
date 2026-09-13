require "rails_helper"

RSpec.describe AnalyticsReport do
  let(:now) { Time.zone.parse("2026-09-13 12:00:00 UTC") }

  def anonymous(name, at: now - 1.day)
    AnalyticsEvent.create!(name: name, occurred_at: at)
  end

  def house_event(name, group:, at: now - 1.day, **properties)
    AnalyticsEvent.create!(name: name, group: group, occurred_at: at,
                           properties: AnalyticsEvent.sanitise_properties(properties))
  end

  describe ".funnel" do
    it "counts every step and each step against the one before it" do
      3.times { anonymous(AnalyticsEvent::LANDING_VIEW) }
      1.times { anonymous(AnalyticsEvent::CTA_CLICK) }

      steps = described_class.funnel(days: 7, now: now)[:steps].index_by { |step| step[:name] }

      expect(steps["landing_view"]).to include(count: 3, conversion: nil)
      expect(steps["cta_click"]).to include(count: 1, conversion: 33.3)
      expect(steps["signin_started"]).to include(count: 0, conversion: 0.0)
    end

    it "ignores events older than the window" do
      anonymous(AnalyticsEvent::LANDING_VIEW, at: now - 30.days)
      anonymous(AnalyticsEvent::LANDING_VIEW, at: now - 1.day)

      steps = described_class.funnel(days: 7, now: now)[:steps]

      expect(steps.first).to include(name: "landing_view", count: 1)
    end

    # A raw row count here would read as "200% of houses that got a text", because two housemates in
    # one house open two links. The step counts houses, so the conversion stays readable.
    it "counts HOUSES at the link-opened step, not housemates" do
      group = create(:group)
      house_event(AnalyticsEvent::FIRST_TEXT_DELIVERED, group: group)
      house_event(AnalyticsEvent::FIRST_MEMBER_LINK_OPENED, group: group, member_id: 1)
      house_event(AnalyticsEvent::FIRST_MEMBER_LINK_OPENED, group: group, member_id: 2)

      steps = described_class.funnel(days: 7, now: now)[:steps].index_by { |step| step[:name] }

      expect(steps["first_member_link_opened"]).to include(count: 1, conversion: 100.0)
    end

    # A side branch, reported against house_named rather than wedged into the sequence, where it
    # would make every step after it read as a collapse.
    it "reports calendar_connected outside the sequence" do
      group = create(:group)
      house_event(AnalyticsEvent::HOUSE_NAMED, group: group)
      house_event(AnalyticsEvent::CALENDAR_CONNECTED, group: group)

      report = described_class.funnel(days: 7, now: now)

      expect(report[:steps].map { |step| step[:name] }).not_to include("calendar_connected")
      expect(report[:calendar_connected]).to eq(count: 1, conversion: 100.0)
    end
  end

  describe ".activation — the one number that matters" do
    def house_named(at: now - 5.days)
      group = create(:group)
      house_event(AnalyticsEvent::HOUSE_NAMED, group: group, at: at)
      group
    end

    def opened(group, member_id, at:)
      house_event(AnalyticsEvent::FIRST_MEMBER_LINK_OPENED, group: group, at: at, member_id: member_id)
    end

    it "counts a house with a delivered text and two housemates' opens inside seven days" do
      group = house_named
      house_event(AnalyticsEvent::FIRST_TEXT_DELIVERED, group: group, at: now - 4.days)
      opened(group, 1, at: now - 4.days)
      opened(group, 2, at: now - 3.days)

      expect(described_class.activation(days: 30, now: now)).to eq(converted: 1, total: 1, rate: 100.0)
    end

    it "does not count a house whose text never arrived" do
      group = house_named
      opened(group, 1, at: now - 4.days)
      opened(group, 2, at: now - 3.days)

      expect(described_class.activation(days: 30, now: now)).to include(converted: 0, total: 1)
    end

    # Two housemates, not one: one is the person who set the house up.
    it "does not count a house where only one housemate opened" do
      group = house_named
      house_event(AnalyticsEvent::FIRST_TEXT_DELIVERED, group: group, at: now - 4.days)
      opened(group, 1, at: now - 4.days)

      expect(described_class.activation(days: 30, now: now)).to include(converted: 0, total: 1)
    end

    it "counts housemates, not events, if a member id ever repeats" do
      group = house_named
      house_event(AnalyticsEvent::FIRST_TEXT_DELIVERED, group: group, at: now - 4.days)
      opened(group, 1, at: now - 4.days)
      opened(group, 1, at: now - 3.days)

      expect(described_class.activation(days: 30, now: now)).to include(converted: 0, total: 1)
    end

    # The clock starts at house_named. An open on day eight is a house that took too long, and the
    # number is about the first week.
    it "ignores an open that lands after the seven days are up" do
      group = house_named(at: now - 20.days)
      house_event(AnalyticsEvent::FIRST_TEXT_DELIVERED, group: group, at: now - 19.days)
      opened(group, 1, at: now - 19.days)
      opened(group, 2, at: now - 11.days)

      expect(described_class.activation(days: 30, now: now)).to include(converted: 0, total: 1)
    end

    it "reports no rate at all when no house was named, rather than nought per cent" do
      expect(described_class.activation(days: 7, now: now)).to eq(converted: 0, total: 0, rate: nil)
    end

    it "renders the rate to one decimal" do
      3.times { house_named }
      converted = house_named
      house_event(AnalyticsEvent::FIRST_TEXT_DELIVERED, group: converted, at: now - 4.days)
      opened(converted, 1, at: now - 4.days)
      opened(converted, 2, at: now - 4.days)

      expect(described_class.activation(days: 30, now: now)[:rate]).to eq(25.0)
    end
  end

  describe ".sources" do
    it "groups houses named by ref and utm_source, commonest first" do
      2.times do
        house_event(AnalyticsEvent::HOUSE_NAMED, group: create(:group), ref: "member")
      end
      house_event(AnalyticsEvent::HOUSE_NAMED, group: create(:group), utm_source: "reddit")
      house_event(AnalyticsEvent::HOUSE_NAMED, group: create(:group))

      expect(described_class.sources(days: 7, now: now)).to eq([
        { ref: "member", utm_source: nil, count: 2 },
        { ref: nil, utm_source: nil, count: 1 },
        { ref: nil, utm_source: "reddit", count: 1 }
      ])
    end

    it "is empty when nothing was named in the window" do
      expect(described_class.sources(days: 7, now: now)).to be_empty
    end
  end
end
