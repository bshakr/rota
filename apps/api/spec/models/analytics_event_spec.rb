require "rails_helper"

RSpec.describe AnalyticsEvent do
  let(:group) { create(:group) }

  describe "the allowlist" do
    it "is ten names, four anonymous and six belonging to a house" do
      expect(described_class::ANONYMOUS_NAMES.size).to eq(4)
      expect(described_class::GROUP_NAMES.size).to eq(6)
      expect(described_class::NAMES.size).to eq(10)
      expect(described_class::NAMES.uniq.size).to eq(10)
    end

    it "refuses a name that is not on it" do
      event = described_class.new(name: "made_up", occurred_at: Time.current)

      expect(event).not_to be_valid
      expect(event.errors[:name]).to be_present
    end
  end

  describe ".record" do
    it "writes a house event with its group and the time it happened" do
      freeze_time do
        expect(described_class.record(described_class::FIRST_ROTA_SAVED, group: group)).to be(true)

        expect(described_class.sole).to have_attributes(
          name: "first_rota_saved", group: group, occurred_at: Time.current, properties: {}
        )
      end
    end

    it "writes an anonymous event with no group at all" do
      described_class.record(described_class::CTA_CLICK, position: "hero")

      expect(described_class.sole).to have_attributes(
        name: "cta_click", group_id: nil, properties: { "position" => "hero" }
      )
    end

    # The invariant every report leans on. A house_named with no group corrupts every count keyed on
    # a NULL group_id, and an anonymous event with a house would put a visitor inside one.
    it "refuses a house event with no house, and an anonymous event with one" do
      expect(described_class.record(described_class::HOUSE_NAMED)).to be(false)
      expect(described_class.record(described_class::LANDING_VIEW, group: group)).to be(false)
      expect(described_class.count).to be_zero
    end

    # Analytics sits inside a request that was otherwise about to succeed. Adding a housemate must
    # never become a 500 because a row would not validate.
    it "never raises into its caller, and says so in the log" do
      allow(Rails.logger).to receive(:warn)

      expect { expect(described_class.record("not_a_real_event")).to be(false) }.not_to raise_error
      expect(Rails.logger).to have_received(:warn).with(/dropped not_a_real_event/)
    end

    it "survives the database refusing the row" do
      allow(described_class).to receive(:create!).and_raise(ActiveRecord::StatementInvalid)
      allow(Rails.logger).to receive(:warn)

      expect { expect(described_class.record(described_class::LANDING_VIEW)).to be(false) }.not_to raise_error
    end
  end

  describe "properties" do
    def properties_for(**props)
      described_class.record(described_class::LANDING_VIEW, **props)
      described_class.last.properties
    end

    it "keeps only the allowlisted keys" do
      expect(properties_for(utm_source: "reddit", gclid: "abc", email: "someone@example.com"))
        .to eq("utm_source" => "reddit")
    end

    it "accepts string keys as well as symbols, because first_touch arrives as strings" do
      expect(properties_for(**{ "ref" => "member" })).to eq("ref" => "member")
    end

    it "trims and caps a value rather than dropping the event that carried it" do
      expect(properties_for(utm_campaign: "  spring  ", utm_source: "a" * 500))
        .to eq("utm_campaign" => "spring", "utm_source" => "a" * described_class::MAX_VALUE_LENGTH)
    end

    it "keeps integers and booleans, and discards anything else" do
      described_class.record(described_class::FIRST_MEMBER_LINK_OPENED, group: group, member_id: 42)
      expect(described_class.last.properties).to eq("member_id" => 42)

      expect(properties_for(utm_source: { nested: "object" }, ref: %w[a b])).to eq({})
    end

    it "drops a blank rather than storing an empty string" do
      expect(properties_for(utm_source: "   ", ref: "member")).to eq("ref" => "member")
    end
  end

  describe ".prune_anonymous" do
    it "deletes anonymous events past the retention window and keeps a house's own" do
      old_anonymous = described_class.create!(name: described_class::LANDING_VIEW, occurred_at: 200.days.ago)
      # Inside the window and older than the 90 days this used to keep: the traffic page's longest
      # range reaches back here, which is the reason the retention was doubled.
      recent_anonymous = described_class.create!(name: described_class::LANDING_VIEW, occurred_at: 100.days.ago)
      old_house = described_class.create!(name: described_class::HOUSE_NAMED, group: group, occurred_at: 400.days.ago)

      expect(described_class.prune_anonymous).to eq(1)

      expect(described_class.exists?(old_anonymous.id)).to be(false)
      expect(described_class.exists?(recent_anonymous.id)).to be(true)
      expect(described_class.exists?(old_house.id)).to be(true)
    end
  end

  # A house's funnel history is the house's. It does not get to outlive it and be counted as
  # anonymous traffic, which is what a nullifying foreign key would have produced.
  it "goes when the house goes" do
    described_class.record(described_class::HOUSE_NAMED, group: group)

    expect { group.destroy! }.to change(described_class, :count).by(-1)
  end
end
