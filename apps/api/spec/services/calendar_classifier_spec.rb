require "rails_helper"

RSpec.describe CalendarClassifier do
  let(:group) { create(:group) }
  let!(:bass) { create(:member, group: group, name: "Bass") }
  let!(:alfie) { create(:member, group: group, name: "Alfie") }

  # max_retries 0 so the failure examples do not sleep through the SDK's two backoffs.
  let(:client) { Anthropic::Client.new(api_key: "sk-ant-api03-test", timeout: 5, max_retries: 0) }
  # The house whose calendar is being read, and so the house every call below is billed to. Lazy, so
  # the fingerprinting examples that never reach the model never build one.
  let(:connection) { create(:calendar_connection, group: group) }
  subject(:classifier) do
    described_class.new(members: group.members.active.to_a, client: client, connection: connection)
  end

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

  # Spec 7.4 is absolute, so every shape of bad reply has to arrive as Failed and not as whatever
  # Ruby raises next. A reply that parses to an ARRAY was the hole: `parsed["verdicts"]` on an Array
  # raises TypeError, which escaped classify, escaped CalendarSync's rescue, and reached the admin
  # as a 500 on connect and on "Sync now" instead of the pending state.
  it "raises Failed when the reply is JSON but not an object" do
    stub_claude_key
    [ "[]", "\"just a string\"", "42", "null" ].each do |text|
      stub_request(:post, AnthropicStubs::MESSAGES_URL).to_return(
        status: 200, headers: { "Content-Type" => "application/json" },
        body: { id: "msg_01Stub", type: "message", role: "assistant", model: "claude-haiku-4-5",
                content: [ { type: "text", text: text } ], stop_reason: "end_turn", stop_sequence: nil,
                usage: { input_tokens: 1, output_tokens: 1 } }.to_json
      )

      expect { classifier.classify([ carlisle ]) }
        .to raise_error(described_class::Failed, /not the JSON the schema asked for/), "for #{text}"
    end
  end

  it "raises Failed when the reply is not JSON at all" do
    stub_claude_key
    stub_request(:post, AnthropicStubs::MESSAGES_URL).to_return(
      status: 200, headers: { "Content-Type" => "application/json" },
      body: { id: "msg_01Stub", type: "message", role: "assistant", model: "claude-haiku-4-5",
              content: [ { type: "text", text: "Sorry, I cannot help with that." } ],
              stop_reason: "end_turn", stop_sequence: nil,
              usage: { input_tokens: 1, output_tokens: 1 } }.to_json
    )

    expect { classifier.classify([ carlisle ]) }
      .to raise_error(described_class::Failed, /not the JSON the schema asked for/)
  end

  # `Array` turns a hash into pairs and a bare string into one string, so a verdicts value of the
  # wrong shape used to reach `raw["ref"]` as an Array and raise TypeError from inside accept.
  it "drops verdicts that are not objects rather than raising" do
    stub_claude_key
    [ { "a" => 1 }, "just a string", [ [ 1, 2 ] ] ].each do |verdicts|
      stub_request(:post, AnthropicStubs::MESSAGES_URL).to_return(
        status: 200, headers: { "Content-Type" => "application/json" },
        body: { id: "msg_01Stub", type: "message", role: "assistant", model: "claude-haiku-4-5",
                content: [ { type: "text", text: JSON.generate(verdicts: verdicts) } ],
                stop_reason: "end_turn", stop_sequence: nil,
                usage: { input_tokens: 1, output_tokens: 1 } }.to_json
      )

      expect(classifier.classify([ carlisle ])).to eq({}), "for #{verdicts.inspect}"
    end
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
    keyless = described_class.new(members: group.members.active.to_a, connection: connection)

    expect { keyless.classify([ carlisle ]) }.to raise_error(described_class::Failed, /ANTHROPIC_API_KEY/) { |e|
      expect(e.verdicts).to eq({})
    }
    expect(a_request(:post, AnthropicStubs::MESSAGES_URL)).not_to have_been_made
    # Nothing was asked for, so nothing was spent. CalendarSync builds a classifier on every sync
    # just to fingerprint, and a house with no key must not accumulate a row an hour that says it
    # spent nothing.
    expect(AiCall.count).to eq(0)
  end

  # Spend collection (BLO-1673). Every request is one ai_calls row, whichever way it ends, because a
  # house that keeps failing to classify is a house that keeps paying for nothing.
  describe "recording what a call cost" do
    # 2150 input at $1 per million and 640 output at $5 is $0.005350.
    let(:usage) { { input_tokens: 2_150, output_tokens: 640 } }

    it "writes one row per chunk, with the usage the reply carried and the cost of it" do
      stub_claude_verdicts([], usage: usage)

      classifier.classify(Array.new(51) { |n| item("fp#{n}", "Event #{n}") })

      expect(AiCall.count).to eq(2)
      expect(AiCall.order(:items_count).pluck(:items_count)).to eq([ 1, 50 ])
      expect(AiCall.last).to have_attributes(
        group_id: group.id, calendar_connection_id: connection.id,
        purpose: "calendar_classify", model: "claude-haiku-4-5",
        input_tokens: 2_150, output_tokens: 640, succeeded: true, error_class: nil,
        cost_usd: "0.005350".to_d
      )
    end

    # Anthropic omits the cache counts when nothing was cached, which is every call this app makes.
    it "records a reply that carried no cache counts as zero, not as nothing" do
      stub_claude_verdicts([])

      classifier.classify([ carlisle ])

      expect(AiCall.sole).to have_attributes(cache_creation_input_tokens: 0, cache_read_input_tokens: 0)
    end

    it "prices the cache counts when a reply does carry them" do
      stub_claude_verdicts([], usage: usage.merge(cache_creation_input_tokens: 800,
                                                  cache_read_input_tokens: 4_000))

      classifier.classify([ carlisle ])

      expect(AiCall.sole).to have_attributes(
        cache_creation_input_tokens: 800, cache_read_input_tokens: 4_000,
        # $0.005350 for the call, plus 800 written at $1.25 and 4000 read at $0.10 per million.
        cost_usd: "0.006750".to_d
      )
    end

    # Anthropic refused the request, so there are no tokens to report and nothing was charged. The
    # row is still written: the point of it is that this house asked and got nowhere.
    it "records a 429 as a failed call named by Anthropic's own error class" do
      stub_claude_key
      stub_request(:post, AnthropicStubs::MESSAGES_URL).to_return(status: 429, body: "{}")

      expect { classifier.classify([ carlisle ]) }.to raise_error(described_class::Failed)

      expect(AiCall.sole).to have_attributes(
        succeeded: false, error_class: "Anthropic::Errors::RateLimitError",
        items_count: 1, input_tokens: 0, output_tokens: 0, cost_usd: 0
      )
    end

    # The other way round: the request was accepted and billed, and the reply was unusable. The
    # tokens are real and must not be lost just because the verdicts were.
    it "records a malformed reply as a failed call that still cost what it spent" do
      stub_claude_key
      stub_request(:post, AnthropicStubs::MESSAGES_URL).to_return(
        status: 200, headers: { "Content-Type" => "application/json" },
        body: { id: "msg_01Stub", type: "message", role: "assistant", model: "claude-haiku-4-5",
                content: [ { type: "text", text: "Sorry, I cannot help with that." } ],
                stop_reason: "end_turn", stop_sequence: nil, usage: usage }.to_json
      )

      # `classify` flattens every cause into one PLAIN Failed for CalendarSync, which is the whole
      # point of that class: a subclass reaching CalendarSync would slip past a rescue written for
      # Failed exactly. The exact class is asserted rather than the ancestry, because `raise_error`
      # on Failed is satisfied by any subclass and would pin nothing. The distinction between "rate
      # limited" and "answered in the wrong shape" survives on the row, which is where an operator
      # goes looking for it.
      expect { classifier.classify([ carlisle ]) }
        .to raise_error(described_class::Failed, /not the JSON the schema asked for/) { |e|
          expect(e.class).to eq(described_class::Failed)
        }

      expect(AiCall.sole).to have_attributes(
        succeeded: false, error_class: "CalendarClassifier::Malformed",
        input_tokens: 2_150, output_tokens: 640, cost_usd: "0.005350".to_d
      )
      expect(AiCall.sole.cost_usd).not_to be_nil
    end

    # The expensive failure: the whole 8192-token output budget spent on an answer that was cut off
    # mid-sentence, roughly eight times what a chunk that answers normally costs. The row names it,
    # so a house doing this every hour is legible on the spend page instead of just looking busy.
    it "records a truncated reply under its own name, priced at what it burned" do
      stub_claude_verdicts([], stop_reason: "max_tokens",
                               usage: { input_tokens: 2_150, output_tokens: 8_192 })

      expect { classifier.classify([ carlisle ]) }
        .to raise_error(described_class::Failed, /max_tokens/) { |e|
          expect(e.class).to eq(described_class::Failed)
        }

      expect(AiCall.sole).to have_attributes(
        succeeded: false, error_class: "CalendarClassifier::Truncated",
        input_tokens: 2_150, output_tokens: 8_192, cost_usd: "0.043110".to_d
      )
    end

    it "records the chunk that failed and the chunks that did not, separately" do
      stub_claude_key
      stub_request(:post, AnthropicStubs::MESSAGES_URL).to_return(
        claude_reply([ { ref: "1", kind: "away", member_ids: [ alfie.id ], reason: "Alfie in Carlisle" } ],
                     usage: usage),
        { status: 500, body: "{}" }
      )

      expect { classifier.classify([ carlisle ] + Array.new(50) { |n| item("later#{n}", "Event #{n}") }) }
        .to raise_error(described_class::Failed)

      expect(AiCall.order(:id).pluck(:succeeded, :error_class, :items_count)).to eq(
        [ [ true, nil, 50 ], [ false, "Anthropic::Errors::InternalServerError", 1 ] ]
      )
    end

    # The failure the row would otherwise lie about. Anthropic answered and billed for it, and then
    # reading the reply blew up, so the tokens exist but the local holding them is discarded by the
    # rescue. They ride out on the Failed instead. Mocked at the SDK boundary because there is no
    # body that reaches it: `messages.create` walks the content eagerly today, so this is the
    # promise that the row stays honest if it ever stops.
    it "prices a reply that was billed and then turned out to be unreadable" do
      stub_claude_key
      reply = instance_double(Anthropic::Models::Message,
                              usage: instance_double(Anthropic::Models::Usage,
                                                     input_tokens: 2_150, output_tokens: 640,
                                                     cache_creation_input_tokens: nil,
                                                     cache_read_input_tokens: nil))
      allow(reply).to receive(:content).and_raise(
        Anthropic::Errors::ConversionError.new(on: Anthropic::Models::Message, method: :content,
                                               target: Anthropic::Internal::Type::Unknown,
                                               value: "not an array")
      )
      allow(client).to receive(:messages)
        .and_return(instance_double(Anthropic::Resources::Messages, create: reply))

      expect { classifier.classify([ carlisle ]) }.to raise_error(described_class::Failed)

      expect(AiCall.sole).to have_attributes(
        succeeded: false, error_class: "Anthropic::Errors::ConversionError",
        input_tokens: 2_150, output_tokens: 640, cost_usd: "0.005350".to_d
      )
    end

    # bin/classifier-eval runs this prompt against the live model on six plain structs and no
    # database. There is nobody to bill, and it stays the write-nothing script it says it is.
    it "writes nothing when there is no house to bill" do
      stub_claude_verdicts([])
      unbilled = described_class.new(members: group.members.active.to_a, client: client)

      unbilled.classify([ carlisle ])

      expect(AiCall.count).to eq(0)
    end

    # Spec 7.4 outranks the bookkeeping: a verdict that was paid for and understood is stored even
    # if writing down what it cost goes wrong.
    it "classifies anyway when the row cannot be written" do
      stub_claude_verdicts([ { ref: "1", kind: "away", member_ids: [ alfie.id ], reason: "Alfie away" } ])
      allow(AiCall).to receive(:create!).and_raise(ActiveRecord::StatementInvalid, "no such table")
      allow(Rails.logger).to receive(:warn)
      allow(Rails.error).to receive(:report)

      expect(classifier.classify([ carlisle ])["fp1"]).to have_attributes(kind: "away")
      expect(Rails.logger).to have_received(:warn).with(/could not record spend/)
      # Reported too. A break here zeroes every house's Claude spend at once, and a warn in a log
      # nobody reads is how that goes unnoticed for a month.
      expect(Rails.error).to have_received(:report).with(
        an_instance_of(ActiveRecord::StatementInvalid),
        context: { group_id: group.id, calendar_connection_id: connection.id },
        source: "rotamonster.ai_call"
      )
    end
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
