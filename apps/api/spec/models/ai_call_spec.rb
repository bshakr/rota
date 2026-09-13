require "rails_helper"

RSpec.describe AiCall do
  # Anything answering to the four token readers will do, which is the point: the SDK's usage object
  # in production, this in a spec. A field left unset is nil, exactly as the SDK reports a count the
  # reply did not carry.
  let(:usage_class) do
    Struct.new(:input_tokens, :output_tokens, :cache_creation_input_tokens,
               :cache_read_input_tokens, keyword_init: true)
  end

  def tokens(input: 0, output: 0, cache_creation: 0, cache_read: 0)
    { input_tokens: input, output_tokens: output,
      cache_creation_input_tokens: cache_creation, cache_read_input_tokens: cache_read }
  end

  describe ".tokens_from" do
    it "reads the four counts off a usage object" do
      usage = usage_class.new(input_tokens: 1_200, output_tokens: 300,
                              cache_creation_input_tokens: 800, cache_read_input_tokens: 4_000)

      expect(described_class.tokens_from(usage))
        .to eq(tokens(input: 1_200, output: 300, cache_creation: 800, cache_read: 4_000))
    end

    # Anthropic leaves the cache counts out of the reply when nothing was cached, and the SDK hands
    # those back as nil. Zero is what "no tokens" means; nil would spread through the arithmetic.
    it "reads a count the reply left out as zero" do
      usage = usage_class.new(input_tokens: 900, output_tokens: 40)

      expect(described_class.tokens_from(usage)).to eq(tokens(input: 900, output: 40))
    end

    # There is no usage to read when the request never produced a reply — a 429, a dropped
    # connection. The row is still written, at zero, because the call is a fact either way.
    it "reads no usage at all as zeroes" do
      expect(described_class.tokens_from(nil)).to eq(tokens)
    end
  end

  describe ".cost_usd_for" do
    # Haiku 4.5: $1 per million input tokens, $5 per million output.
    it "prices input and output at the published rate" do
      cost = described_class.cost_usd_for("claude-haiku-4-5", tokens(input: 2_150, output: 640))

      expect(cost).to eq("0.005350".to_d)
    end

    # A cache read is a tenth of the input rate, a cache write a quarter again on top of it.
    it "prices cache reads and cache writes against the input rate" do
      cost = described_class.cost_usd_for(
        "claude-haiku-4-5", tokens(input: 1_200, output: 300, cache_creation: 800, cache_read: 4_000)
      )

      expect(cost).to eq("0.004100".to_d)
    end

    it "costs nothing when the call spent nothing" do
      expect(described_class.cost_usd_for("claude-haiku-4-5", tokens)).to eq(0)
    end

    # Six decimal places, the same as the column, so the value reads identically before and after a
    # round trip through Postgres.
    it "rounds to the six decimal places the column stores" do
      expect(described_class.cost_usd_for("claude-haiku-4-5", tokens(cache_read: 6)))
        .to eq("0.000001".to_d)
    end

    # This runs inside a call the house has already been billed for. An id we do not recognise costs
    # a blank column and a log line; the tokens beside it are still the truth.
    it "prices an unknown model at nil rather than raising" do
      allow(Rails.logger).to receive(:warn)

      expect(described_class.cost_usd_for("claude-sonnet-5", tokens(input: 10, output: 10))).to be_nil
      expect(Rails.logger).to have_received(:warn).with(/claude-sonnet-5/)
    end
  end

  it "keeps the spend when the connection that spent it is deleted" do
    connection = create(:calendar_connection)
    call = create(:ai_call, group: connection.group, calendar_connection: connection)

    connection.destroy!

    expect(call.reload).to have_attributes(calendar_connection_id: nil, cost_usd: "0.002700".to_d)
  end
end
