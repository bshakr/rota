# Asks Claude which calendar titles mean a housemate is away. The house writes them the way people
# write things ("Alfie away in Carlisle", "Ciara - France", "Raph off to Lisbon"), and no formula
# survives the next title nobody anticipated, so a small model reads them instead (spec section 7).
#
# Two rules hold this together. The reply is data, never instruction: every verdict is checked
# against the refs we sent and the roster we sent before anything is stored, and nothing from it is
# interpolated anywhere except a `reason` that is truncated and rendered as text. And a title is the
# house's own business: it never reaches a log line or an exception message, so a Failed carries the
# cause's class and error type and nothing else.
#
# Failures are partial rather than all-or-nothing. Every chunk is attempted even after one fails,
# and the verdicts that did come back ride out on Failed#verdicts, so CalendarSync can store those
# and leave the rest pending:
#
#   begin
#     verdicts = classifier.classify(items)
#   rescue CalendarClassifier::Failed => e
#     verdicts = e.verdicts   # a Hash, empty when nothing succeeded
#   end
class CalendarClassifier
  Verdict = Struct.new(:kind, :member_ids, :reason, keyword_init: true)

  # `verdicts` carries whatever came back before the failure, so a caller never has to throw away
  # answers it has already paid for. Empty when nothing succeeded.
  class Failed < StandardError
    attr_reader :verdicts

    def initialize(message, verdicts: {})
      super(message)
      @verdicts = verdicts
    end
  end

  BATCH_SIZE = 50
  MAX_TOKENS = 8192
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

    Give a reason of one short clause, under fifteen words, the kind of thing an admin can read
    next to the title: "Alfie, three nights in Carlisle", or "a birthday, not a trip".

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
  #
  # A chunk that fails does not discard the ones that already worked. Every chunk is attempted, and
  # if any failed the Failed raised afterwards carries the rest on #verdicts: a 429 on the last
  # chunk of a first sync no longer throws away the hundred verdicts before it.
  def classify(items)
    return {} if items.empty?

    # Resolve the key before spending anything. A missing key is a configuration failure rather than
    # a per-chunk one, so it should surface as one clear Failed instead of once per chunk.
    client

    earned = {}
    failure = nil

    items.each_slice(BATCH_SIZE) do |chunk|
      earned.merge!(classify_chunk(chunk))
    rescue Failed => e
      failure ||= e
    end

    raise Failed.new(failure.message, verdicts: earned) if failure

    earned
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
    refs = wire_refs(chunk)

    stop_reason, text = read_reply(JSON.generate(payload_for(chunk, refs.keys)))
    raise Failed, "the model stopped on #{stop_reason}" unless stop_reason == :end_turn
    raise Failed, "the reply carried no text block" if text.nil?

    accept(JSON.parse(text)["verdicts"], refs)
  rescue JSON::ParserError
    raise Failed, "the reply was not the JSON the schema asked for"
  end

  # The whole of the SDK boundary: making the call and reading the reply's fields. Everything of
  # ours is assembled before this is entered, so the blanket rescue below cannot hide our own bugs.
  #
  # Spec 7.4 is absolute: a failed call never fails the sync, and CalendarSync's only handle on that
  # is CalendarClassifier::Failed. Three separate kinds of failure have to arrive as one. Status and
  # connection errors are the obvious ones. Then the SDK coerces response fields lazily inside its
  # accessors, so a body it cannot convert raises ConversionError, which descends from
  # Anthropic::Errors::Error and not from APIError. And `messages.create` walks the reply's content
  # eagerly to unwrap tool schemas, so a body whose content is not an array raises a plain
  # NoMethodError from inside the gem, which is not an Anthropic error at all. Hence StandardError
  # last: whatever class the gem throws over the wall, it means the call did not produce an answer.
  def read_reply(user_message)
    message = request(user_message)
    block = message.content.find { |candidate| candidate.type == :text }

    [ message.stop_reason, block&.text ]
  rescue Anthropic::Errors::APIStatusError => e
    # The class already names the status (RateLimitError is the 429, InternalServerError the 5xx)
    # and `.type` adds the API's own label when the body carried one. A bodyless 429 carries none,
    # so do not trail an empty pair of brackets.
    raise Failed, e.type.present? ? "#{e.class} (#{e.type})" : e.class.to_s
  rescue StandardError => e
    raise Failed, e.class.to_s
  end

  def request(user_message)
    client.messages.create(
      model: model,
      max_tokens: MAX_TOKENS,
      system_: system_prompt,
      messages: [ { role: "user", content: user_message } ],
      output_config: { format_: { type: "json_schema", schema: SCHEMA } }
    )
  end

  # The model echoes a position within the chunk, "1" to "50", never a fingerprint. A 64-character
  # hex string costs roughly 25 output tokens to echo, so fifty of them would spend a quarter of the
  # budget before a single verdict was written, and one mistyped hex character would silently drop a
  # verdict forever. This is the only place the numbering is decided; payload_for is handed the keys
  # rather than working them out again, so the two cannot drift apart.
  def wire_refs(chunk)
    chunk.each_with_index.to_h { |item, index| [ (index + 1).to_s, item[:ref].to_s ] }
  end

  def payload_for(chunk, refs)
    chunk.zip(refs).map do |item, ref|
      {
        ref: ref,
        title: item[:summary],
        all_day: item[:all_day],
        starts_on: item[:starts_on].iso8601,
        ends_on: item[:ends_on].iso8601,
        nights: (item[:ends_on] - item[:starts_on]).to_i
      }
    end
  end

  # Spec 7.2. Anything that fails a check is dropped rather than argued with; the next sync asks
  # again, which is cheaper than a repair path nobody will ever read.
  def accept(verdicts, refs)
    Array(verdicts).each_with_object({}) do |raw, accepted|
      # refs maps the positional ref the model was given back to the caller's ref. A ref we never
      # sent has no entry, so an invented one is dropped here.
      ref = refs[raw["ref"].to_s]
      next if ref.nil?

      kind = raw["kind"].to_s
      next unless KINDS.include?(kind)

      member_ids = Array(raw["member_ids"]).map(&:to_i).uniq.select { |id| roster_ids.include?(id) }
      kind = "event" if kind == "away" && member_ids.empty?
      # Not in 7.2: an event marks nobody away, so ids on one are noise the store should not keep.
      member_ids = [] if kind == "event"

      accepted[ref] = Verdict.new(kind: kind, member_ids: member_ids,
                                  reason: raw["reason"].to_s.squish.truncate(REASON_LIMIT).presence)
    end
  end
end
