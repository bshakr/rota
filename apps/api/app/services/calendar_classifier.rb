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
  #
  # `error_class` is what the ai_calls row records as the cause. It defaults to this class's own
  # name, which is right for the failures we decide on ourselves, and is set explicitly at the SDK
  # boundary so a 429 is recorded as Anthropic's own RateLimitError rather than as a word of ours.
  # A string rather than a class: it is written to a column and read on a spend page long after the
  # gem that named it has moved on.
  #
  # `usage` is what the reply said it spent, when there was a reply at all. A failure that happened
  # after Anthropic answered was still billed, and the tokens would otherwise be lost with the local
  # that held them, leaving the spend page reading a call that cost real money as costing nothing.
  # Nil for a failure that never got an answer — a 429, a dropped connection — which is recorded at
  # zero because zero is what it spent.
  class Failed < StandardError
    attr_reader :verdicts, :error_class, :usage

    def initialize(message, verdicts: {}, error_class: nil, usage: nil)
      super(message)
      @verdicts = verdicts
      @error_class = error_class || self.class.name
      @usage = usage
    end
  end

  # The call went through and the reply was not the shape the schema asked for. A separate class
  # only so `error_class` can tell the two apart on the spend page: "Anthropic is rate limiting this
  # house" and "the model keeps answering in the wrong shape" are different problems that cost the
  # same. Still a Failed, so CalendarSync's single rescue keeps catching both.
  class Malformed < Failed; end

  # The model filled its whole output budget and was cut off mid-answer. Its own class because it is
  # the expensive failure: a truncated chunk burns all of MAX_TOKENS, roughly eight times what a
  # chunk that answers normally spends, so it is the one the spend page most needs to name.
  class Truncated < Failed; end

  BATCH_SIZE = 50
  MAX_TOKENS = 8192
  REASON_LIMIT = 120
  TIMEOUT_SECONDS = 20
  MAX_RETRIES = 2
  KINDS = %w[event away].freeze
  # What an ai_calls row says this spend was for. The spend page splits by it, so a second thing we
  # ever ask a model is a second string here and not a second table.
  PURPOSE = "calendar_classify"
  # What every "the model did not answer in the shape it was asked for" failure says. One sentence,
  # because the admin can do nothing with the difference and the next sync asks again anyway.
  MALFORMED = "the reply was not the JSON the schema asked for"

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

  # `connection` is only ever the house's CalendarConnection, and only so a call can be billed to
  # the house that made it. It is optional because bin/classifier-eval runs the same prompt against
  # the live model on six plain structs and no database at all: with nothing to bill, nothing is
  # written, and the eval stays the read-nothing, write-nothing script it says it is.
  def initialize(members:, model: Rails.configuration.x.calendar_classifier.model, client: nil,
                 connection: nil)
    @roster = members.map { |member| [ member.id, member.name.to_s ] }.sort_by(&:first)
    @model = model
    @client = client
    @connection = connection
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

  attr_reader :model, :connection

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

  # One request, and one ai_calls row for it either way. The tokens reach that row by two routes,
  # because a reply can fail either of two checks. When read_reply returns, the usage comes back with
  # it and the local below holds it. When read_reply raises, the local is never assigned and the
  # usage rides out on the exception instead — nil when the request never produced an answer.
  def classify_chunk(chunk)
    refs = wire_refs(chunk)
    usage = nil

    verdicts = begin
      stop_reason, text, usage = read_reply(JSON.generate(payload_for(chunk, refs.keys)))
      raise Truncated, "the model stopped on #{stop_reason}" if stop_reason == :max_tokens
      raise Failed, "the model stopped on #{stop_reason}" unless stop_reason == :end_turn
      raise Malformed, "the reply carried no text block" if text.nil?

      accept(verdicts_in(text), refs)
    rescue Failed => e
      record_spend(chunk.size, e.usage || usage, succeeded: false, error_class: e.error_class)
      raise
    end

    record_spend(chunk.size, usage, succeeded: true)
    verdicts
  end

  # What this call cost the house, written where it was spent (super admin plan, "where spend is
  # recorded"). The cost is a snapshot taken now, from the rate table, so a later edit to a rate
  # cannot move a month that has already been reported.
  #
  # Nothing in here may cost a house its calendar. A classification that worked is not allowed to
  # come undone because the bookkeeping did, so every failure is swallowed and logged; the log line
  # carries classes and counts, never a title.
  def record_spend(items_count, usage, succeeded:, error_class: nil)
    return if connection.nil?

    tokens = AiCall.tokens_from(usage)
    AiCall.create!(tokens.merge(
      group_id: connection.group_id, calendar_connection_id: connection.id,
      purpose: PURPOSE, model: model, items_count: items_count,
      succeeded: succeeded, error_class: error_class,
      cost_usd: AiCall.cost_usd_for(model, tokens)
    ))
  rescue StandardError => e
    Rails.logger.warn("CalendarClassifier could not record spend for connection " \
                      "#{connection.id}: #{e.class}: #{e.message}")
    # Reported as well as logged, for the same reason CalendarSync reports a failed classification:
    # swallowing this quietly is how a schema drift or a mistyped rate would zero out every house's
    # Claude spend for a month with nothing to show that it had happened.
    Rails.error.report(e, context: { group_id: connection.group_id, calendar_connection_id: connection.id },
                          source: "rotamonster.ai_call")
  end

  # Spec 7.4 is absolute, so the shape of the reply is checked rather than assumed. Structured
  # output makes anything but an object near-unreachable, but "near" is not the promise: a reply
  # that parses to an array or a number would make `parsed["verdicts"]` raise TypeError, which is
  # not Failed, and a 500 would reach the admin in place of the pending state 7.4 guarantees.
  def verdicts_in(text)
    parsed = JSON.parse(text)
    raise Malformed, MALFORMED unless parsed.is_a?(Hash)

    parsed["verdicts"]
  rescue JSON::ParserError
    raise Malformed, MALFORMED
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
  #
  # The usage rides back with the reply so the chunk can be billed, and is read before the content
  # is walked so that it is already in hand if walking the content is what fails. It goes out on the
  # Failed in that case, because a local would be discarded by the rescue and the call would be
  # recorded as free. It stays nil when the request itself never produced a reply, which is the one
  # case where the house really was charged nothing.
  def read_reply(user_message)
    usage = nil
    message = request(user_message)
    usage = message.usage
    block = message.content.find { |candidate| candidate.type == :text }

    [ message.stop_reason, block&.text, usage ]
  rescue Anthropic::Errors::APIStatusError => e
    # The class already names the status (RateLimitError is the 429, InternalServerError the 5xx)
    # and `.type` adds the API's own label when the body carried one. A bodyless 429 carries none,
    # so do not trail an empty pair of brackets. The class alone, without the label, is what the
    # spend row records: it is the part that stays the same across two 429s worded differently.
    raise Failed.new(e.type.present? ? "#{e.class} (#{e.type})" : e.class.to_s,
                     error_class: e.class.to_s, usage: usage)
  rescue StandardError => e
    raise Failed.new(e.class.to_s, error_class: e.class.to_s, usage: usage)
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
      # A verdict that is not an object at all is dropped rather than read: `Array` turns a hash
      # into pairs and a string into one string, and `raw["ref"]` on either would raise out of a
      # method whose contract is that a bad reply costs verdicts, never the sync.
      next unless raw.is_a?(Hash)

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
