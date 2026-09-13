require "rails_helper"

# What a house costs to run, from the two rows that spent the money: sms_messages and ai_calls.
#
# The figures this produces are the ones a price gets set against, so the questions below are less
# about arithmetic than about honesty — which texts are a real charge and which are a guess, what a
# number means when the denominator is zero, and whether a percentile over tens of houses says what
# it claims to.
RSpec.describe SuperAdmin::Spend do
  # A fixed "now" for every example. Ranges are relative to it, so a clock that drifts across
  # midnight mid-suite would otherwise move the window under the rows.
  let(:now) { Time.utc(2026, 9, 13, 12, 0, 0) }

  around { |example| travel_to(now) { example.run } }

  # Twilio's per-segment estimate, as the query object defaults it. Written out rather than read
  # from the constant so a change to the default has to change this file too.
  let(:segment_rate) { "0.0079".to_d }

  def result(range: nil)
    described_class.call(range: range)
  end

  # --- fixtures ---------------------------------------------------------------------------------
  # Texts are created as `member_login` rows: that kind is the only one the check constraints let
  # stand without a shift, and nothing here cares what the text said.

  def member_for(group, **attrs)
    @members ||= {}
    @members[[ group.id, attrs ]] ||= create(:member, group: group, **attrs)
  end

  def next_sid
    @sid_counter = @sid_counter.to_i + 1
    format("SM%032d", @sid_counter)
  end

  # One text. `sid: false` is a row Twilio never accepted, which is also the only way a row can be
  # sent-with-no-SID — the shape the estimate must refuse to price.
  def text(group, at: now, status: "delivered", sid: true, member: nil, **attrs)
    create(
      :sms_message,
      kind: "member_login", shift: nil, days_before: nil,
      member: member || member_for(group),
      status: status,
      twilio_sid: sid ? next_sid : nil,
      created_at: at,
      **attrs
    )
  end

  # A text Twilio has settled a charge for: price present and price_fetched_at stamped, which is
  # the pair that means "asked, and answered".
  def settled_text(group, amount: "0.0079", unit: "USD", **attrs)
    text(group, price: amount.to_d, price_unit: unit, price_fetched_at: attrs[:at] || now, **attrs)
  end

  def claude_call(group, *traits, at: now, **attrs)
    create(:ai_call, *traits, group: group, created_at: at, **attrs)
  end

  # Swap ENV for the duration of a block and put back exactly what was there, including "was not
  # set at all" — the same shape spec/lib/tasks/twilio_rake_spec.rb uses.
  def with_env(values)
    original = values.transform_values { nil }.merge(ENV.slice(*values.keys))
    ENV.update(values)
    yield
  ensure
    original.each { |key, value| value.nil? ? ENV.delete(key) : ENV[key] = value }
  end

  describe "the range" do
    it "defaults to 30 days, so a caller that passes nothing still gets an answer" do
      expect(result[:range]).to eq("30d")
      expect(result[:months_in_range]).to eq(1)
    end

    it "accepts a blank range the same way, because a bare query string is not a bad one" do
      expect(result(range: "")[:range]).to eq("30d")
    end

    it "refuses a range it does not know rather than guessing at one" do
      expect { result(range: "6m") }.to raise_error(described_class::UnknownRange, /6m/)
    end

    it "counts 90d as three months and 12m as twelve, which is what per-month divides by" do
      expect(result(range: "90d")[:months_in_range]).to eq(3)
      expect(result(range: "12m")[:months_in_range]).to eq(12)
    end

    it "starts 12m at the first of the month eleven months back, so the series is whole months" do
      expect(result(range: "12m")[:starts_at]).to eq(Time.utc(2025, 10, 1).iso8601)
    end
  end

  describe "the window's edges" do
    let(:group) { create(:group) }

    it "counts a text on the first instant of the window and not one a second before it" do
      settled_text(group, at: now - 30.days)
      settled_text(group, at: now - 30.days - 1.second)

      expect(result[:totals][:texts_settled]).to eq(1)
    end

    it "counts a Claude call inside the window and not one before it" do
      claude_call(group, at: now - 30.days)
      claude_call(group, at: now - 30.days - 1.second)

      expect(result[:totals][:claude_calls]).to eq(1)
    end

    it "widens to reach a row that only 90d covers" do
      settled_text(group, at: now - 60.days)

      expect(result[:totals][:texts_settled]).to eq(0)
      expect(result(range: "90d")[:totals][:texts_settled]).to eq(1)
    end
  end

  describe "what a text costs" do
    let(:group) { create(:group) }

    it "uses Twilio's settled price where there is one" do
      settled_text(group, amount: "0.0079")
      settled_text(group, amount: "0.0158")

      totals = result[:totals]
      expect(totals[:sms_cost_settled]).to eq(0.0237)
      expect(totals[:texts_settled]).to eq(2)
      expect(totals[:sms_cost_estimated]).to eq(0.0)
      expect(totals[:texts_estimated]).to eq(0)
    end

    it "estimates a sent text Twilio has not priced yet, and says how many rows that is" do
      text(group, num_segments: 2)
      text(group, num_segments: 1)

      totals = result[:totals]
      expect(totals[:sms_cost_estimated]).to eq((segment_rate * 3).to_f)
      expect(totals[:texts_estimated]).to eq(2)
      expect(totals[:sms_cost_settled]).to eq(0.0)
    end

    it "keeps settled and estimated apart and sums both into the SMS cost" do
      settled_text(group, amount: "0.0100")
      text(group, num_segments: 1)

      totals = result[:totals]
      expect(totals[:sms_cost_settled]).to eq(0.01)
      expect(totals[:sms_cost_estimated]).to eq(segment_rate.to_f)
      expect(totals[:sms_cost]).to eq((BigDecimal("0.01") + segment_rate).to_f)
    end

    it "reads a missing segment count as one segment rather than as free" do
      text(group, num_segments: nil)

      expect(result[:totals][:sms_cost_estimated]).to eq(segment_rate.to_f)
    end

    it "charges nothing for a text Twilio rejected" do
      text(group, status: "failed", error_code: "21610", num_segments: 1)

      totals = result[:totals]
      expect(totals[:sms_cost_estimated]).to eq(0.0)
      expect(totals[:texts_estimated]).to eq(0)
      expect(totals[:texts_sent]).to eq(0)
    end

    it "charges nothing for a text that has not gone out yet" do
      text(group, status: "pending", sid: false, num_segments: nil)
      text(group, status: "sending", sid: false, num_segments: nil)

      expect(result[:totals][:sms_cost_estimated]).to eq(0.0)
      expect(result[:totals][:texts_estimated]).to eq(0)
    end

    it "still reports a settled price on a row that later failed, because the charge is real" do
      settled_text(group, amount: "0.0079", status: "failed", error_code: "30006")

      expect(result[:totals][:sms_cost_settled]).to eq(0.0079)
    end

    it "counts segments only for texts that actually went out" do
      text(group, num_segments: 3)
      text(group, status: "failed", num_segments: 5)

      expect(result[:totals][:segments]).to eq(3)
      expect(result[:totals][:texts_sent]).to eq(1)
    end
  end

  describe "a price billed in another currency" do
    let(:group) { create(:group) }

    it "is kept out of the USD total and reported on its own" do
      settled_text(group, amount: "0.0400", unit: "GBP")
      settled_text(group, amount: "0.0079", unit: "USD")

      totals = result[:totals]
      expect(totals[:sms_cost_settled]).to eq(0.0079)
      expect(totals[:sms_cost_other_currencies]).to eq([ { unit: "GBP", amount: 0.04 } ])
      expect(totals[:total]).to eq(0.0079)
    end

    it "reports nothing when every charge is in dollars" do
      settled_text(group)

      expect(result[:totals][:sms_cost_other_currencies]).to eq([])
    end

    it "treats a settled price with no unit as dollars, which is what Twilio bills us in" do
      settled_text(group, amount: "0.0079", unit: nil)

      expect(result[:totals][:sms_cost_settled]).to eq(0.0079)
      expect(result[:totals][:sms_cost_other_currencies]).to eq([])
    end

    it "surfaces the other currency on the house's own row too" do
      settled_text(group, amount: "0.0400", unit: "GBP")

      expect(result[:houses].first[:sms_cost_other_currencies]).to eq([ { unit: "GBP", amount: 0.04 } ])
    end
  end

  describe "what Claude costs" do
    let(:group) { create(:group) }

    it "sums the snapshot cost, the tokens and the titles a succeeded call classified" do
      claude_call(group, input_tokens: 1_000, output_tokens: 200, cost_usd: "0.0020".to_d, items_count: 40)
      claude_call(group, input_tokens: 500, output_tokens: 100, cost_usd: "0.0010".to_d, items_count: 10)

      totals = result[:totals]
      expect(totals[:claude_calls]).to eq(2)
      expect(totals[:claude_cost]).to eq(0.003)
      expect(totals[:claude_tokens_in]).to eq(1_500)
      expect(totals[:claude_tokens_out]).to eq(300)
      expect(totals[:titles_classified]).to eq(50)
    end

    it "counts every input-side token, cached or not, as tokens in" do
      claude_call(
        group,
        input_tokens: 100, cache_creation_input_tokens: 20, cache_read_input_tokens: 5, output_tokens: 7
      )

      expect(result[:totals][:claude_tokens_in]).to eq(125)
      expect(result[:totals][:claude_tokens_out]).to eq(7)
    end

    it "keeps a failed call's cost, because Anthropic charged for it" do
      claude_call(group, :failed, cost_usd: "0.0004".to_d, items_count: 30)

      totals = result[:totals]
      expect(totals[:claude_calls]).to eq(1)
      expect(totals[:claude_cost]).to eq(0.0004)
      expect(totals[:titles_classified]).to eq(0)
    end

    it "counts a call nobody could price rather than reading it as free" do
      claude_call(group, cost_usd: nil, items_count: 10)

      expect(result[:totals][:claude_calls_unpriced]).to eq(1)
      expect(result[:totals][:claude_cost]).to eq(0.0)
    end
  end

  describe "the per-house rows" do
    it "sorts by total spend, biggest first" do
      cheap = create(:group, name: "Cheap")
      dear = create(:group, name: "Dear")
      settled_text(cheap, amount: "0.0100")
      settled_text(dear, amount: "0.5000")

      expect(result[:houses].map { |house| house[:name] }).to eq([ "Dear", "Cheap" ])
      expect(result[:houses].map { |house| house[:group_id] }).to eq([ dear.id, cheap.id ])
    end

    it "leaves out a house that spent nothing in the range, and says how many exist" do
      spender = create(:group)
      create(:group)
      settled_text(spender)

      expect(result[:houses].map { |house| house[:group_id] }).to eq([ spender.id ])
      expect(result[:houses_active]).to eq(1)
      expect(result[:houses_total]).to eq(2)
    end

    it "counts a house with a Claude call but no text as active" do
      group = create(:group)
      claude_call(group)

      expect(result[:houses].map { |house| house[:group_id] }).to eq([ group.id ])
    end

    it "divides the total by the members the house can still text" do
      group = create(:group)
      3.times { create(:member, group: group) }
      create(:member, group: group, active: false)
      create(:member, group: group, sms_opted_out_at: 1.day.ago)
      settled_text(group, amount: "0.3000", member: group.members.first)

      house = result[:houses].first
      expect(house[:active_members]).to eq(3)
      expect(house[:total_per_active_member]).to eq(0.1)
    end

    it "answers nil, not an error, when the house has nobody left to text" do
      group = create(:group)
      lapsed = create(:member, group: group, active: false)
      settled_text(group, amount: "0.3000", member: lapsed)

      house = result[:houses].first
      expect(house[:active_members]).to eq(0)
      expect(house[:total_per_active_member]).to be_nil
    end
  end

  describe "the allocated fixed cost" do
    it "is nil everywhere when FIXED_MONTHLY_COST_USD is not set" do
      group = create(:group)
      settled_text(group)

      expect(result[:fixed_monthly_cost_usd]).to be_nil
      expect(result[:houses].first[:allocated_fixed_cost]).to be_nil
    end

    it "splits across the houses active in the range and prorates by the months in it" do
      active = [ create(:group), create(:group) ]
      create(:group)
      active.each { |group| settled_text(group) }

      with_env("FIXED_MONTHLY_COST_USD" => "120") do
        ninety = result(range: "90d")

        expect(ninety[:fixed_monthly_cost_usd]).to eq(120.0)
        expect(ninety[:houses].map { |house| house[:allocated_fixed_cost] }).to eq([ 180.0, 180.0 ])
      end
    end

    it "gives the whole month's cost to the one house that was active" do
      group = create(:group)
      create(:group)
      settled_text(group)

      with_env("FIXED_MONTHLY_COST_USD" => "120") do
        expect(result[:houses].first[:allocated_fixed_cost]).to eq(120.0)
      end
    end

    it "keeps it out of the house's own total, which is variable cost only" do
      group = create(:group)
      settled_text(group, amount: "0.0079")

      with_env("FIXED_MONTHLY_COST_USD" => "120") do
        expect(result[:houses].first[:total]).to eq(0.0079)
      end
    end

    it "ignores a value that is not a number rather than reporting a wrong one" do
      group = create(:group)
      settled_text(group)

      with_env("FIXED_MONTHLY_COST_USD" => "$120/mo") do
        expect(result[:fixed_monthly_cost_usd]).to be_nil
        expect(result[:houses].first[:allocated_fixed_cost]).to be_nil
      end
    end
  end

  describe "the per-segment estimate rate" do
    it "is reported so the reader can see what the estimate was built from" do
      expect(result[:sms_estimated_segment_cost_usd]).to eq(segment_rate.to_f)
    end

    it "can be overridden with SMS_ESTIMATED_SEGMENT_COST_USD" do
      group = create(:group)
      text(group, num_segments: 2)

      with_env("SMS_ESTIMATED_SEGMENT_COST_USD" => "0.01") do
        expect(result[:sms_estimated_segment_cost_usd]).to eq(0.01)
        expect(result[:totals][:sms_cost_estimated]).to eq(0.02)
      end
    end

    it "falls back to the default when the override is not a number" do
      with_env("SMS_ESTIMATED_SEGMENT_COST_USD" => "cheap") do
        expect(result[:sms_estimated_segment_cost_usd]).to eq(segment_rate.to_f)
      end
    end
  end

  describe "unit economics" do
    # Nearest rank: the p-th percentile is the value at ceil(p/100 * n) in the ascending order.
    # With ten houses that puts the median at the 5th and the p90 at the 9th — both real houses,
    # never an average of two.
    it "reads the median and p90 off real houses" do
      totals = [ 1, 2, 3, 4, 5, 6, 7, 8, 9, 10 ]
      totals.each do |dollars|
        group = create(:group)
        settled_text(group, amount: format("%.4f", dollars))
      end

      economics = result[:unit_economics][:cost_per_house_per_month]
      expect(economics[:median]).to eq(5.0)
      expect(economics[:p90]).to eq(9.0)
      expect(result[:unit_economics][:houses_measured]).to eq(10)
    end

    it "gives one house's own figure as both the median and the p90" do
      group = create(:group)
      settled_text(group, amount: "0.2500")

      economics = result[:unit_economics][:cost_per_house_per_month]
      expect(economics[:median]).to eq(0.25)
      expect(economics[:p90]).to eq(0.25)
    end

    it "takes the lower of two houses as the median, which is what nearest rank means" do
      [ "0.1000", "0.9000" ].each do |amount|
        settled_text(create(:group), amount: amount)
      end

      economics = result[:unit_economics][:cost_per_house_per_month]
      expect(economics[:median]).to eq(0.1)
      expect(economics[:p90]).to eq(0.9)
    end

    it "divides a house's spend by the months in the range" do
      group = create(:group)
      settled_text(group, amount: "0.9000")

      expect(result(range: "90d")[:unit_economics][:cost_per_house_per_month][:median]).to eq(0.3)
    end

    it "measures cost per active member per month over the houses that have members" do
      housed = create(:group)
      2.times { create(:member, group: housed) }
      settled_text(housed, amount: "0.4000", member: housed.members.first)

      empty = create(:group)
      lapsed = create(:member, group: empty, active: false)
      settled_text(empty, amount: "9.0000", member: lapsed)

      economics = result[:unit_economics]
      expect(economics[:cost_per_active_member_per_month][:median]).to eq(0.2)
      expect(economics[:houses_with_active_members]).to eq(1)
    end

    it "answers nil for every figure when nothing was spent at all" do
      economics = result[:unit_economics]

      expect(economics[:cost_per_house_per_month]).to eq({ median: nil, p90: nil })
      expect(economics[:cost_per_active_member_per_month]).to eq({ median: nil, p90: nil })
      expect(economics[:cost_per_text_sent]).to be_nil
      expect(economics[:cost_per_title_classified]).to be_nil
    end

    it "prices a text against the texts that went out and a title against the calls that read it" do
      group = create(:group)
      settled_text(group, amount: "0.0100")
      settled_text(group, amount: "0.0300")
      claude_call(group, cost_usd: "0.0500".to_d, items_count: 25)

      economics = result[:unit_economics]
      expect(economics[:cost_per_text_sent]).to eq(0.02)
      expect(economics[:cost_per_title_classified]).to eq(0.002)
    end
  end

  describe "the monthly series" do
    let(:group) { create(:group) }

    it "runs one entry per calendar month the range touches, in order, gaps filled" do
      months = result(range: "12m")[:months]

      expect(months.length).to eq(12)
      expect(months.first[:month]).to eq("2025-10")
      expect(months.last[:month]).to eq("2026-09")
      expect(months.first[:total]).to eq(0.0)
    end

    it "puts each month's texts and Claude calls in their own entry, as separate figures" do
      settled_text(group, amount: "0.0500", at: Time.utc(2026, 8, 20))
      claude_call(group, at: Time.utc(2026, 9, 2), cost_usd: "0.0300".to_d, items_count: 12)

      months = result[:months].index_by { |month| month[:month] }

      expect(months["2026-08"][:sms_cost_settled]).to eq(0.05)
      expect(months["2026-08"][:claude_cost]).to eq(0.0)
      expect(months["2026-09"][:claude_cost]).to eq(0.03)
      expect(months["2026-09"][:titles_classified]).to eq(12)
      expect(months["2026-09"][:sms_cost_settled]).to eq(0.0)
    end

    it "buckets by UTC month, which is the clock a cross-house total has to use" do
      settled_text(group, amount: "0.0500", at: Time.utc(2026, 9, 1, 0, 30))

      months = result[:months].index_by { |month| month[:month] }
      expect(months["2026-09"][:sms_cost_settled]).to eq(0.05)
      expect(months["2026-08"][:sms_cost_settled]).to eq(0.0)
    end
  end

  describe "caching" do
    let(:store) { ActiveSupport::Cache::MemoryStore.new }

    before { allow(Rails).to receive(:cache).and_return(store) }

    it "serves the same answer inside the window rather than asking the database again" do
      group = create(:group)
      settled_text(group, amount: "0.0100")

      first = described_class.cached(range: "30d")
      settled_text(group, amount: "9.0000")

      expect(described_class.cached(range: "30d")).to eq(first)
    end

    it "keys on the range, so a different window is a different answer" do
      group = create(:group)
      settled_text(group, amount: "0.0100", at: now - 60.days)

      expect(described_class.cached(range: "30d")[:totals][:sms_cost_settled]).to eq(0.0)
      expect(described_class.cached(range: "90d")[:totals][:sms_cost_settled]).to eq(0.01)
    end

    it "refuses an unknown range before it reaches the cache" do
      expect { described_class.cached(range: "6m") }.to raise_error(described_class::UnknownRange)
    end

    # Solid Cache outlives a deploy, so a payload whose shape has changed would be served to the new
    # page for a minute if the key were not versioned. Asserted rather than trusted, because the
    # suffix reads as clutter to anyone who does not know what it is for.
    it "versions the key, so a deploy that changes the payload cannot serve the old shape" do
      expect(described_class.cache_key("30d")).to eq("super_admin/spend/v1/30d")
    end
  end

  describe "the shape it returns" do
    it "names the currency and the window it measured" do
      answer = result

      expect(answer[:currency]).to eq("USD")
      expect(answer[:starts_at]).to eq((now - 30.days).iso8601)
      expect(answer[:ends_at]).to eq(now.iso8601)
    end

    it "serialises money as JSON numbers, never as strings" do
      group = create(:group)
      settled_text(group, amount: "0.0079")

      expect(result[:totals][:sms_cost_settled]).to be_a(Numeric)
      expect(result.to_json).to include('"sms_cost_settled":0.0079')
    end
  end
end
