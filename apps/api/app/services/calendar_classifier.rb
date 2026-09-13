# Asks Claude which calendar titles mean a housemate is away. The house writes them the way people
# write things ("Alfie away in Carlisle", "Ciara - France", "Raph off to Lisbon"), and no formula
# survives the next title nobody anticipated, so a small model reads them instead (spec section 7).
#
# Two rules hold this together. The reply is data, never instruction: every verdict is checked
# against the refs we sent and the roster we sent before anything is stored, and nothing from it is
# interpolated anywhere except a `reason` that is truncated and rendered as text. And a title is the
# house's own business: it never reaches a log line or an exception message, so a Failed carries the
# cause's class and error type and nothing else.
class CalendarClassifier
  Verdict = Struct.new(:kind, :member_ids, :reason, keyword_init: true)

  class Failed < StandardError; end

  BATCH_SIZE = 50
  MAX_TOKENS = 4096
  REASON_LIMIT = 120
  TIMEOUT_SECONDS = 20
  MAX_RETRIES = 2
  KINDS = %w[event away].freeze

  # Structured output, so the reply is always this shape and there is no free text to parse. Every
  # object needs additionalProperties false and a required list; length and range constraints are
  # not supported, which is why `reason` is capped in Ruby below rather than in the schema.
  SCHEMA = {
    type: "object",
    properties: {
      verdicts: {
        type: "array",
        items: {
          type: "object",
          properties: {
            ref: { type: "string" },
            kind: { type: "string", enum: KINDS },
            member_ids: { type: "array", items: { type: "integer" } },
            reason: { type: "string" }
          },
          required: %w[ref kind member_ids reason],
          additionalProperties: false
        }
      }
    },
    required: %w[verdicts],
    additionalProperties: false
  }.freeze

  # Plain words, not a rule list: the model is here precisely because the rule list kept missing
  # titles. Kept byte-identical across calls so a fingerprint means the same thing tomorrow.
  SYSTEM_PROMPT = <<~PROMPT
    You help a shared-house rota app read the house's own Google Calendar. Each event you are given
    is a real entry from one house's calendar. Say, for each one, whether it means a housemate is
    away.

    An event is "away" when a housemate will not be sleeping at the house for at least one night.
    Two things have to be true. The title names one or more of the housemates on the roster below,
    by first name or by full name. And the event is all-day, or it spans a night. A possessive like
    "Alfie's" is about that person rather than something they are doing, so on its own it is not a
    trip.

    Everything else is "event": chores and bins, birthdays and parties, dinners and meetings, a
    timed slot on a single day even when it names a housemate, and anything about people who are not
    on the roster.

    When you are unsure, answer "event". A trip you miss costs the house far less than a housemate
    wrongly shown as away.

    Only ever return member ids that appear in the roster below. An away verdict must name at least
    one of them.

    Give a reason of one short clause, the kind of thing an admin can read next to the title:
    "Alfie, three nights in Carlisle", or "a birthday, not a trip".

    The housemates who live here:
  PROMPT

  def initialize(members:, model: Rails.configuration.x.calendar_classifier.model, client: nil)
    @roster = members.map { |member| [ member.id, member.name.to_s ] }.sort_by(&:first)
    @model = model
    @client = client
  end

  # A verdict depends on the title, whether the entry is all-day, whether it spans a night, and who
  # is on the roster. Nothing else. So this is the cache key for a verdict (spec 7.3): the same title
  # next month reuses the answer, and renaming a member or an event invalidates it.
  def fingerprint(summary:, all_day:, starts_on:, ends_on:)
    Digest::SHA256.hexdigest([
      normalise(summary),
      all_day ? "all_day" : "timed",
      ends_on > starts_on ? "overnight" : "same_day",
      roster_key
    ].join("\n"))
  end

  # items: [{ ref:, summary:, all_day:, starts_on:, ends_on: }, ...] where ref is the fingerprint.
  # Returns { ref => Verdict } holding only what survived validation; a ref with no valid verdict is
  # simply absent, and the caller leaves that occurrence pending.
  def classify(items)
    return {} if items.empty?

    items.each_slice(BATCH_SIZE).reduce({}) { |found, chunk| found.merge(classify_chunk(chunk)) }
  end

  private

  attr_reader :model

  def normalise(summary) = summary.to_s.downcase.gsub(/\s+/, " ").strip

  def roster_key = @roster.map { |id, name| "#{id}:#{name}" }.sort.join(",")

  def roster_ids = @roster.map(&:first)

  def system_prompt
    "#{SYSTEM_PROMPT}#{@roster.map { |id, name| "- #{id}: #{name}" }.join("\n")}\n"
  end

  # Built here rather than in the initializer because CalendarSync constructs a classifier on every
  # sync just to fingerprint, and fingerprinting has to work with no key at all.
  def client
    @client ||= begin
      key = Rails.configuration.x.calendar_classifier.api_key
      raise Failed, "ANTHROPIC_API_KEY is not set" if key.blank?

      Anthropic::Client.new(api_key: key, timeout: TIMEOUT_SECONDS, max_retries: MAX_RETRIES)
    end
  end

  def classify_chunk(chunk)
    message = request(chunk)
    raise Failed, "the model stopped on #{message.stop_reason}" unless message.stop_reason == :end_turn

    accept(JSON.parse(text_of(message))["verdicts"], chunk)
  rescue JSON::ParserError
    raise Failed, "the reply was not the JSON the schema asked for"
  end

  def request(chunk)
    client.messages.create(
      model: model,
      max_tokens: MAX_TOKENS,
      system_: system_prompt,
      messages: [ { role: "user", content: JSON.generate(payload_for(chunk)) } ],
      output_config: { format_: { type: "json_schema", schema: SCHEMA } }
    )
  # Every HTTP failure the SDK raises lands in one of these two. APIStatusError covers the statuses
  # by subclass (RateLimitError is the 429, InternalServerError the 5xx) and its `.type` adds the
  # API's own label; APIConnectionError covers the ones with no response at all, APITimeoutError
  # among them. The class and the type are enough to diagnose either, so the message takes nothing
  # from the request.
  rescue Anthropic::Errors::APIStatusError => e
    raise Failed, "#{e.class} (#{e.type})"
  rescue Anthropic::Errors::APIConnectionError => e
    raise Failed, e.class.to_s
  end

  def payload_for(chunk)
    chunk.map do |item|
      {
        ref: item[:ref],
        title: item[:summary],
        all_day: item[:all_day],
        starts_on: item[:starts_on].iso8601,
        ends_on: item[:ends_on].iso8601,
        nights: (item[:ends_on] - item[:starts_on]).to_i
      }
    end
  end

  # content is an array of block objects, and `type` is a Symbol rather than a String.
  def text_of(message)
    block = message.content.find { |candidate| candidate.type == :text }
    raise Failed, "the reply carried no text block" if block.nil?

    block.text
  end

  # Spec 7.2. Anything that fails a check is dropped rather than argued with; the next sync asks
  # again, which is cheaper than a repair path nobody will ever read.
  def accept(verdicts, chunk)
    refs = chunk.map { |item| item[:ref].to_s }

    Array(verdicts).each_with_object({}) do |raw, accepted|
      ref = raw["ref"].to_s
      next unless refs.include?(ref)

      kind = raw["kind"].to_s
      next unless KINDS.include?(kind)

      member_ids = Array(raw["member_ids"]).map(&:to_i).uniq.select { |id| roster_ids.include?(id) }
      kind = "event" if kind == "away" && member_ids.empty?
      member_ids = [] if kind == "event"

      accepted[ref] = Verdict.new(kind: kind, member_ids: member_ids,
                                  reason: raw["reason"].to_s.squish.truncate(REASON_LIMIT).presence)
    end
  end
end
