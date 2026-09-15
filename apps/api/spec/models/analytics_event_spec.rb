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

  # The six coarse facts about a visit, drawn by the traffic page's "Where visits come from" panel.
  # Each has a SHAPE as well as a length, and a value of the wrong shape costs the event that
  # property rather than the event: a chart an operator reads must not be able to grow a bar labelled
  # with whatever a stranger posted.
  describe "the visit properties" do
    def properties_for(**props)
      described_class.record(described_class::LANDING_VIEW, **props)
      described_class.last.properties
    end

    it "keeps a referrer host, a country and a device class" do
      expect(properties_for(referrer_host: "news.ycombinator.com", country: "GB", device: "mobile"))
        .to eq("referrer_host" => "news.ycombinator.com", "country" => "GB", "device" => "mobile")
    end

    it "accepts a host with a port, which is what URL.host hands back in development" do
      expect(properties_for(referrer_host: "localhost:3001")).to eq("referrer_host" => "localhost:3001")
    end

    # One storage form per key. Two rows saying "Reddit.com" and "reddit.com" are one referrer and
    # must not draw two bars.
    it "stores one spelling of a host and of a country, whatever case it arrived in" do
      expect(properties_for(referrer_host: "Reddit.COM", country: "gb"))
        .to eq("referrer_host" => "reddit.com", "country" => "GB")
    end

    it "drops a referrer that is a whole URL, or a sentence, rather than a host" do
      expect(properties_for(referrer_host: "https://reddit.com/r/uk?q=me@example.com")).to eq({})
      expect(properties_for(referrer_host: "look at this")).to eq({})
      expect(properties_for(referrer_host: "-leading-hyphen.com")).to eq({})
    end

    # \A and \z rather than ^ and $: in Ruby those match either side of a newline, so a pattern
    # anchored with them would take a hostname on the first line and anything at all on the second.
    it "drops a host that is only a hostname until the first newline" do
      expect(properties_for(referrer_host: "reddit.com\nand a second line")).to eq({})
    end

    it "drops a country that is not two letters, and the markers that are not countries" do
      expect(properties_for(country: "GBR")).to eq({})
      expect(properties_for(country: "United Kingdom")).to eq({})
      expect(properties_for(country: "XX")).to eq({})
      expect(properties_for(country: "T1")).to eq({})
    end

    it "drops a device class nobody defined" do
      expect(properties_for(device: "fridge")).to eq({})
      expect(properties_for(device: "Mobile")).to eq({})
    end

    it "keeps a city, a browser family and a system family" do
      expect(properties_for(city: "London", browser: "safari", os: "ios"))
        .to eq("city" => "London", "browser" => "safari", "os" => "ios")
    end

    # Written exactly as the header sent them. There is no case-folding rule that is right for the
    # names of every place on earth, and title-casing would make "Saint-étienne" of the first of
    # these.
    it "keeps the accents, hyphens, apostrophes and full stops a city name really has" do
      names = [
        "Saint-Étienne", "St. Albans", "N'Djamena", "Ciudad Juárez", "Stratford-upon-Avon",
        # Dutch names that genuinely START with an apostrophe, in both spellings: this hop carries
        # JSON rather than a header, so a typographic apostrophe really can arrive here. Requiring a
        # letter first would have cost both of them their city and nobody would have seen it happen.
        "'s-Hertogenbosch", "’s-Gravenhage"
      ]

      names.each { |city| expect(properties_for(city: city)).to eq("city" => city) }
    end

    it "still needs a letter after that apostrophe" do
      expect(properties_for(city: "'")).to eq({})
      expect(properties_for(city: "''")).to eq({})
      expect(properties_for(city: "'-")).to eq({})
    end

    # `clean_value` shortens an over-long string, because a campaign LABEL is worth keeping the front
    # of. A city is not: storing the first 200 letters of a 250-letter run draws a row nobody can
    # read, so a value that arrives at the cap is refused rather than filed.
    it "refuses a city at the length cap rather than storing the front of one" do
      expect(properties_for(city: "a" * (described_class::MAX_VALUE_LENGTH + 50))).to eq({})
      expect(properties_for(city: "a" * described_class::MAX_VALUE_LENGTH)).to eq({})

      just_under = "a" * (described_class::MAX_VALUE_LENGTH - 1)
      expect(properties_for(city: just_under)).to eq("city" => just_under)
    end

    # The column is read by a person, so a value that is really an id or a sentence somebody chose is
    # how a dashboard becomes a noticeboard. Same argument as the referrer host above.
    it "drops a city that is an id, a sentence or markup rather than a name" do
      expect(properties_for(city: "8675309")).to eq({})
      expect(properties_for(city: "London<script>alert(1)</script>")).to eq({})
      expect(properties_for(city: "51.50853,-0.12574")).to eq({})
    end

    it "drops a city that is only a name until the first newline" do
      expect(properties_for(city: "London\nand a second line")).to eq({})
    end

    # A family, never a version. A stored "Chrome 141.0.7390.55" would be most of a fingerprint, and
    # the only reliable way not to store one is for the shape to have no room for it.
    it "drops a browser or a system that is a version, a spelling or a name nobody defined" do
      expect(properties_for(browser: "Chrome")).to eq({})
      expect(properties_for(browser: "chrome 141")).to eq({})
      expect(properties_for(browser: "netscape")).to eq({})
      expect(properties_for(os: "macOS")).to eq({})
      expect(properties_for(os: "windows 11")).to eq({})
      expect(properties_for(os: "haiku")).to eq({})
    end

    it "keeps the properties that were fine and drops only the one that was not" do
      expect(properties_for(utm_source: "reddit", country: "nonsense", device: "desktop"))
        .to eq("utm_source" => "reddit", "device" => "desktop")
      expect(properties_for(city: "London", browser: "netscape", os: "macos"))
        .to eq("city" => "London", "os" => "macos")
    end

    # `clean_value` lets an Integer and a boolean through untouched, because `member_id` needs that,
    # and JSON has numbers, so a body saying `"country": 44` really does arrive here. A regex check
    # on a number raises, `.record` rescues everything, and the WHOLE EVENT would vanish rather than
    # the one bad property. That is the opposite of this class's rule and would take the landing view
    # with it.
    it "drops a number where a country or a host belongs, and still writes the event" do
      expect(described_class.record(described_class::LANDING_VIEW,
        path: "/", country: 44, referrer_host: 1234, device: true)).to be(true)

      expect(described_class.last.properties).to eq("path" => "/")
    end

    it "drops a number where a city, a browser or a system belongs, and still writes the event" do
      expect(described_class.record(described_class::LANDING_VIEW,
        path: "/", city: 8675309, browser: 141, os: false)).to be(true)

      expect(described_class.last.properties).to eq("path" => "/")
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
