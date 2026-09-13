require "rails_helper"

RSpec.describe CalendarClassifier do
  let(:group) { create(:group) }
  let!(:bass) { create(:member, group: group, name: "Bass") }
  let!(:alfie) { create(:member, group: group, name: "Alfie") }

  # max_retries 0 so the failure examples do not sleep through the SDK's two backoffs.
  let(:client) { Anthropic::Client.new(api_key: "sk-ant-api03-test", timeout: 5, max_retries: 0) }
  subject(:classifier) { described_class.new(members: group.members.active.to_a, client: client) }

  def item(ref, summary, all_day: true, starts_on: Date.new(2026, 9, 16), ends_on: Date.new(2026, 9, 19))
    { ref: ref, summary: summary, all_day: all_day, starts_on: starts_on, ends_on: ends_on }
  end

  def carlisle = item("fp1", "Alfie away in Carlisle (Filming)")

  # WebMock counts requests but does not hand back an ordered list of them, and the chunking
  # examples need the second request specifically. This is its public callback.
  let(:sent_bodies) { [] }
  before { WebMock.after_request { |request, _response| sent_bodies << request.body } }
  after { WebMock.reset_callbacks }

  # The refs the model was asked to echo, in order, for the nth request.
  def refs_sent(index)
    JSON.parse(JSON.parse(sent_bodies.fetch(index)).dig("messages", 0, "content")).map { |sent| sent["ref"] }
  end

  it "sends the model, the schema, the roster and the titles, and nothing else from the feed" do
    stub_claude_verdicts([ { ref: "1", kind: "away", member_ids: [ alfie.id ], reason: "Alfie, three nights in Carlisle" } ])

    classifier.classify([ carlisle ])

    expect(a_request(:post, AnthropicStubs::MESSAGES_URL).with { |request|
      body = JSON.parse(request.body)
      system = body["system"]
      user = body.dig("messages", 0, "content")
      body["model"] == "claude-haiku-4-5" &&
        body["max_tokens"] == 8192 &&
        body.dig("output_config", "format", "type") == "json_schema" &&
        body.dig("output_config", "format", "schema", "properties", "verdicts").present? &&
        system.include?("Alfie") && system.include?(alfie.id.to_s) && system.include?("Bass") &&
        user.include?("Alfie away in Carlisle (Filming)") &&
        !request.body.include?("instance_key") && !request.body.include?("google.com")
    }).to have_been_made
  end

  it "asks the model to echo a short positional ref, never the fingerprint" do
    stub_claude_verdicts([])

    classifier.classify([ carlisle, item("fp2", "Bins out") ])

    expect(refs_sent(0)).to eq([ "1", "2" ])
    expect(a_request(:post, AnthropicStubs::MESSAGES_URL).with { |request|
      !request.body.include?("fp1") && !request.body.include?("fp2")
    }).to have_been_made
  end

  it "numbers refs from one again in each chunk" do
    stub_claude_verdicts([])

    classifier.classify(Array.new(51) { |n| item("fp#{n}", "Event #{n}") })

    expect(refs_sent(0)).to eq((1..50).map(&:to_s))
    expect(refs_sent(1)).to eq([ "1" ])
  end

  it "turns a valid reply into verdicts keyed by the caller's own refs" do
    stub_claude_verdicts([ { ref: "1", kind: "away", member_ids: [ alfie.id ], reason: "Alfie, three nights in Carlisle" } ])

    expect(classifier.classify([ carlisle ])).to eq(
      "fp1" => described_class::Verdict.new(kind: "away", member_ids: [ alfie.id ], reason: "Alfie, three nights in Carlisle")
    )
  end

  it "maps a later chunk's refs back to that chunk's own callers" do
    stub_claude_for_titles("Event 50" => [ "away", [ bass.id ], "Bass is away" ])

    result = classifier.classify(Array.new(51) { |n| item("fp#{n}", "Event #{n}") })

    expect(result["fp50"]).to have_attributes(kind: "away", member_ids: [ bass.id ])
    expect(result["fp0"].kind).to eq("event")
  end

  it "drops a ref it was never asked about" do
    stub_claude_verdicts([ { ref: "invented", kind: "away", member_ids: [ alfie.id ], reason: "made up" } ])

    expect(classifier.classify([ carlisle ])).to eq({})
  end

  it "drops member ids that are not on the roster" do
    stub_claude_verdicts([ { ref: "1", kind: "away", member_ids: [ alfie.id, 99_999 ], reason: "Alfie and a stranger" } ])

    expect(classifier.classify([ carlisle ])["fp1"].member_ids).to eq([ alfie.id ])
  end

  it "turns an away verdict with nobody on it into an event" do
    stub_claude_verdicts([ { ref: "1", kind: "away", member_ids: [], reason: "somebody is away" } ])

    expect(classifier.classify([ carlisle ])["fp1"]).to have_attributes(kind: "event", member_ids: [])
  end

  it "ignores a kind it does not know" do
    stub_claude_verdicts([ { ref: "1", kind: "maybe", member_ids: [ alfie.id ], reason: "hedging" } ])

    expect(classifier.classify([ carlisle ])).to eq({})
  end

  it "truncates the reason to 120 characters" do
    stub_claude_verdicts([ { ref: "1", kind: "event", member_ids: [], reason: "n" * 400 } ])

    expect(classifier.classify([ carlisle ])["fp1"].reason.length).to eq(120)
  end

  it "sends 101 events as three requests" do
    stub_claude_verdicts([])

    classifier.classify(Array.new(101) { |n| item("fp#{n}", "Event #{n}") })

    expect(a_request(:post, AnthropicStubs::MESSAGES_URL)).to have_been_made.times(3)
  end

  it "raises Failed on a 429, a 500 and a timeout, and never puts the title in the message" do
    stub_claude_key

    [ 429, 500 ].each do |status|
      stub_request(:post, AnthropicStubs::MESSAGES_URL).to_return(status: status, body: "{}")
      expect { classifier.classify([ carlisle ]) }.to raise_error(described_class::Failed) { |e|
        expect(e.message).not_to include("Carlisle")
        expect(e.message).not_to include("sk-ant")
        # A bodyless status carries no error.type, so the message must not trail an empty pair.
        expect(e.message).not_to include("()")
      }
    end

    stub_request(:post, AnthropicStubs::MESSAGES_URL).to_timeout
    expect { classifier.classify([ carlisle ]) }.to raise_error(described_class::Failed) { |e|
      expect(e.message).not_to include("Carlisle")
    }
  end

  it "names the API's error type when the body carried one" do
    stub_claude_key
    stub_request(:post, AnthropicStubs::MESSAGES_URL)
      .to_return(status: 429, headers: { "Content-Type" => "application/json" },
                 body: { type: "error", error: { type: "rate_limit_error", message: "slow down" } }.to_json)

    expect { classifier.classify([ carlisle ]) }
      .to raise_error(described_class::Failed, /RateLimitError \(rate_limit_error\)/)
  end

  # A 200 the SDK cannot make a Message of. `messages.create` walks the reply's content eagerly, so
  # this one raises a plain NoMethodError from inside the gem, which is not an Anthropic error at
  # all. Spec 7.4 still says the sync must not fail, so it has to arrive as Failed.
  it "raises Failed when the reply is not a message the SDK can read" do
    stub_claude_key
    stub_request(:post, AnthropicStubs::MESSAGES_URL).to_return(
      status: 200, headers: { "Content-Type" => "application/json" },
      body: { id: "msg_01Stub", type: "message", role: "assistant", model: "claude-haiku-4-5",
              content: "not an array", stop_reason: "end_turn", stop_sequence: nil,
              usage: { input_tokens: 1, output_tokens: 1 } }.to_json
    )

    expect { classifier.classify([ carlisle ]) }.to raise_error(described_class::Failed) { |e|
      expect(e.message).to eq("NoMethodError")
      expect(e.message).not_to include("Carlisle")
    }
  end

  # The other half of the same gap: the SDK coerces response fields lazily inside its accessors, so
  # reading stop_reason or content can raise ConversionError, which descends from
  # Anthropic::Errors::Error rather than APIError. A rescue around the call alone would miss it.
  it "raises Failed when the SDK cannot coerce a field of the reply" do
    stub_claude_key
    allow(client).to receive(:messages).and_raise(
      Anthropic::Errors::ConversionError.new(
        on: Anthropic::Models::Message, method: :content,
        target: Anthropic::Internal::Type::Unknown, value: "not an array"
      )
    )

    expect { classifier.classify([ carlisle ]) }
      .to raise_error(described_class::Failed, /ConversionError/)
  end

  it "raises Failed when the model runs out of tokens or refuses" do
    stub_claude_verdicts([], stop_reason: "max_tokens")
    expect { classifier.classify([ carlisle ]) }.to raise_error(described_class::Failed, /max_tokens/)

    stub_claude_verdicts([], stop_reason: "refusal")
    expect { classifier.classify([ carlisle ]) }.to raise_error(described_class::Failed, /refusal/)
  end

  it "carries the verdicts it already earned when a later chunk fails" do
    stub_claude_key
    stub_request(:post, AnthropicStubs::MESSAGES_URL).to_return(
      claude_reply([ { ref: "1", kind: "away", member_ids: [ alfie.id ], reason: "Alfie in Carlisle" } ]),
      { status: 500, body: "{}" }
    )

    items = [ carlisle ] + Array.new(50) { |n| item("later#{n}", "Event #{n}") }

    expect { classifier.classify(items) }.to raise_error(described_class::Failed) { |e|
      expect(e.verdicts.keys).to eq([ "fp1" ])
      expect(e.verdicts["fp1"]).to have_attributes(kind: "away", member_ids: [ alfie.id ])
    }
  end

  it "raises Failed when no key is configured, without reaching the network" do
    allow(Rails.configuration.x.calendar_classifier).to receive(:api_key).and_return(nil)
    keyless = described_class.new(members: group.members.active.to_a)

    expect { keyless.classify([ carlisle ]) }.to raise_error(described_class::Failed, /ANTHROPIC_API_KEY/) { |e|
      expect(e.verdicts).to eq({})
    }
    expect(a_request(:post, AnthropicStubs::MESSAGES_URL)).not_to have_been_made
  end

  it "fingerprints the title, the shape and the roster, and nothing else" do
    args = { summary: "Alfie in Greece", all_day: true, starts_on: Date.new(2026, 9, 25), ends_on: Date.new(2026, 10, 1) }
    first = classifier.fingerprint(**args)

    expect(classifier.fingerprint(**args.merge(summary: "  ALFIE   in   Greece "))).to eq(first)
    expect(classifier.fingerprint(**args.merge(starts_on: Date.new(2026, 11, 2), ends_on: Date.new(2026, 11, 9)))).to eq(first)
    expect(classifier.fingerprint(**args.merge(summary: "Alfie in Crete"))).not_to eq(first)
    expect(classifier.fingerprint(**args.merge(all_day: false))).not_to eq(first)
    expect(classifier.fingerprint(**args.merge(ends_on: args[:starts_on]))).not_to eq(first)

    alfie.update!(name: "Alfred")
    expect(described_class.new(members: group.members.active.to_a, client: client).fingerprint(**args)).not_to eq(first)
  end
end
