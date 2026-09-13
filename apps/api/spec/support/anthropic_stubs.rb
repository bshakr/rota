# Every spec that reaches CalendarClassifier goes through here, so there is exactly one place that
# knows the shape of a Messages API reply. WebMock blocks the network besides: the only way a house's
# titles could reach Anthropic from a spec is by writing a stub that bypasses this file.
module AnthropicStubs
  MESSAGES_URL = "https://api.anthropic.com/v1/messages"
  # What a reply says it spent unless an example cares. Deliberately carries no cache counts:
  # Anthropic leaves them out when nothing was cached, which is every call this app makes today,
  # so the default reply is the shape the spend collector actually meets.
  DEFAULT_USAGE = { input_tokens: 1, output_tokens: 1 }.freeze

  # Test boots with no ANTHROPIC_API_KEY, and the initializer has no development fallback (spec 7.4
  # wants a missing key to behave like a failed call). A spec that wants the call to happen says so.
  def stub_claude_key(key = "sk-ant-api03-test")
    allow(Rails.configuration.x.calendar_classifier).to receive(:api_key).and_return(key)
  end

  # `verdicts` is what the model would have answered: [{ ref:, kind:, member_ids:, reason: }, ...].
  def stub_claude_verdicts(verdicts, stop_reason: "end_turn", usage: DEFAULT_USAGE)
    stub_claude_key
    stub_request(:post, MESSAGES_URL)
      .to_return(claude_reply(verdicts, stop_reason: stop_reason, usage: usage))
  end

  # CalendarSync specs cannot know the fingerprints, so this answers whatever was asked: `kinds` maps
  # a title to [kind, member_ids, reason], and any title not listed comes back as a plain event.
  def stub_claude_for_titles(kinds)
    stub_claude_key
    stub_request(:post, MESSAGES_URL).to_return do |request|
      items = JSON.parse(JSON.parse(request.body).dig("messages", 0, "content"))
      claude_reply(items.map { |item|
        kind, member_ids, reason = kinds.fetch(item["title"], [ "event", [], "not a trip" ])
        { ref: item["ref"], kind: kind, member_ids: member_ids, reason: reason }
      })
    end
  end

  # Public so a spec can hand several replies to one `to_return` and fail only the second chunk.
  def claude_reply(verdicts, stop_reason: "end_turn", usage: DEFAULT_USAGE)
    {
      status: 200,
      headers: { "Content-Type" => "application/json" },
      body: {
        id: "msg_01Stub", type: "message", role: "assistant", model: "claude-haiku-4-5",
        content: [ { type: "text", text: JSON.generate(verdicts: verdicts) } ],
        stop_reason: stop_reason, stop_sequence: nil,
        usage: usage
      }.to_json
    }
  end
end

RSpec.configure { |config| config.include AnthropicStubs }
