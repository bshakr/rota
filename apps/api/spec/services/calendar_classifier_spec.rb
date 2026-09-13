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

  it "sends the model, the schema, the roster and the titles, and nothing else from the feed" do
    stub_claude_verdicts([ { ref: "fp1", kind: "away", member_ids: [ alfie.id ], reason: "Alfie, three nights in Carlisle" } ])

    classifier.classify([ carlisle ])

    expect(a_request(:post, AnthropicStubs::MESSAGES_URL).with { |request|
      body = JSON.parse(request.body)
      system = body["system"]
      user = body.dig("messages", 0, "content")
      body["model"] == "claude-haiku-4-5" &&
        body.dig("output_config", "format", "type") == "json_schema" &&
        body.dig("output_config", "format", "schema", "properties", "verdicts").present? &&
        system.include?("Alfie") && system.include?(alfie.id.to_s) && system.include?("Bass") &&
        user.include?("Alfie away in Carlisle (Filming)") && user.include?("fp1") &&
        !request.body.include?("instance_key") && !request.body.include?("google.com")
    }).to have_been_made
  end

  it "turns a valid reply into verdicts" do
    stub_claude_verdicts([ { ref: "fp1", kind: "away", member_ids: [ alfie.id ], reason: "Alfie, three nights in Carlisle" } ])

    expect(classifier.classify([ carlisle ])).to eq(
      "fp1" => described_class::Verdict.new(kind: "away", member_ids: [ alfie.id ], reason: "Alfie, three nights in Carlisle")
    )
  end

  it "drops a ref it was never asked about" do
    stub_claude_verdicts([ { ref: "invented", kind: "away", member_ids: [ alfie.id ], reason: "made up" } ])

    expect(classifier.classify([ carlisle ])).to eq({})
  end

  it "drops member ids that are not on the roster" do
    stub_claude_verdicts([ { ref: "fp1", kind: "away", member_ids: [ alfie.id, 99_999 ], reason: "Alfie and a stranger" } ])

    expect(classifier.classify([ carlisle ])["fp1"].member_ids).to eq([ alfie.id ])
  end

  it "turns an away verdict with nobody on it into an event" do
    stub_claude_verdicts([ { ref: "fp1", kind: "away", member_ids: [], reason: "somebody is away" } ])

    expect(classifier.classify([ carlisle ])["fp1"]).to have_attributes(kind: "event", member_ids: [])
  end

  it "ignores a kind it does not know" do
    stub_claude_verdicts([ { ref: "fp1", kind: "maybe", member_ids: [ alfie.id ], reason: "hedging" } ])

    expect(classifier.classify([ carlisle ])).to eq({})
  end

  it "truncates the reason to 120 characters" do
    stub_claude_verdicts([ { ref: "fp1", kind: "event", member_ids: [], reason: "n" * 400 } ])

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
      }
    end

    stub_request(:post, AnthropicStubs::MESSAGES_URL).to_timeout
    expect { classifier.classify([ carlisle ]) }.to raise_error(described_class::Failed) { |e|
      expect(e.message).not_to include("Carlisle")
    }
  end

  it "raises Failed when the model runs out of tokens or refuses" do
    stub_claude_verdicts([], stop_reason: "max_tokens")
    expect { classifier.classify([ carlisle ]) }.to raise_error(described_class::Failed, /max_tokens/)

    stub_claude_verdicts([], stop_reason: "refusal")
    expect { classifier.classify([ carlisle ]) }.to raise_error(described_class::Failed, /refusal/)
  end

  it "raises Failed when no key is configured, without reaching the network" do
    allow(Rails.configuration.x.calendar_classifier).to receive(:api_key).and_return(nil)
    keyless = described_class.new(members: group.members.active.to_a)

    expect { keyless.classify([ carlisle ]) }.to raise_error(described_class::Failed, /ANTHROPIC_API_KEY/)
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
