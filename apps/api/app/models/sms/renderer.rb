module Sms
  # Turns a rota's message template into the text a member actually receives.
  #
  # Two callers, one code path: SendSmsJob renders the real thing, and the rota editor renders a
  # live preview against a real member. A preview that went through different code would be a
  # preview of nothing.
  class Renderer
    # The whole vocabulary. Anything else in a template is a typo, and Rota refuses to save it —
    # see Rota#message_template_placeholders_must_be_known. This constant is the single place the
    # vocabulary is defined; the validation, the renderer and the admin UI's hint all read it.
    PLACEHOLDERS = %w[name rota date days_until].freeze

    # Deliberately loose: it matches `{{ anything at all }}`, including `{{}}`, so that a typo is
    # *found* and named rather than quietly left in the body as literal braces.
    PLACEHOLDER_PATTERN = /\{\{(.*?)\}\}/

    # "Sat 5 Jul" — day and month spelled, no leading zero, no year. A reminder is always about the
    # next few days, and a year in it reads like a machine wrote it.
    DATE_FORMAT = "%a %-d %b".freeze

    # Twilio rejects a body over 1600 characters outright (a permanent failure), and every 160-char
    # GSM-7 segment past the first costs money. The body is clamped to this so a runaway template or
    # a pathologically long member name cannot bill for thirty segments or fail the send — and the
    # clamp is applied to the message text only, never the magic link, which must always survive
    # intact. Rota also caps the template at save (Rota::MESSAGE_TEMPLATE_MAX) so the admin sees the
    # limit rather than silent truncation; this is the belt to that suspenders.
    MAX_BODY_LENGTH = 1600

    def self.render(rota:, member:, due_on:)
      new(rota: rota, member: member, due_on: due_on).body
    end

    # Reminders resolve the recipient at send time, which is why a handover needs no special
    # reminder logic: hand Alice's shift to Bob and every remaining reminder goes to him. Pass
    # `member:` to render for somebody else, which is what an admin previewing a template wants.
    def self.for_shift(shift, member: nil)
      render(rota: shift.rota, member: member || shift.responsible_member, due_on: shift.due_on)
    end

    def self.unknown_placeholders(template)
      template.to_s.scan(PLACEHOLDER_PATTERN).flatten.map(&:strip).uniq - PLACEHOLDERS
    end

    # A brace left over once every well-formed `{{...}}` token is removed. `"Hi {{name}"` has no
    # closing pair, so PLACEHOLDER_PATTERN never matches it and the typo would otherwise be texted
    # out as the literal string `Hi {{name}`. Caught here, it is rejected at save instead — the same
    # "a text cannot be recalled" reason the vocabulary is enforced at all.
    def self.stray_braces?(template)
      template.to_s.gsub(PLACEHOLDER_PATTERN, "").match?(/[{}]/)
    end

    def initialize(rota:, member:, due_on:)
      @rota = rota
      @member = member
      @due_on = due_on
    end

    # The magic link is appended rather than placed, and is not a placeholder. It is how the member
    # reaches every other action in the product; a template that forgot it would be a text nobody
    # can act on. The link is never truncated — only the message text is clamped, and only if
    # clamping is needed to keep the whole body under Twilio's hard limit.
    def body
      suffix = "\nManage: #{magic_link}"
      budget = MAX_BODY_LENGTH - suffix.length
      "#{filled_template.truncate(budget)}#{suffix}"
    end

    private

    attr_reader :rota, :member, :due_on

    def filled_template
      template = rota.message_template.to_s
      raise MalformedTemplate, template if self.class.stray_braces?(template)

      unknown = self.class.unknown_placeholders(template)
      raise UnknownPlaceholder, unknown if unknown.any?

      template.gsub(PLACEHOLDER_PATTERN) { values.fetch(Regexp.last_match(1).strip) }
    end

    def values
      @values ||= {
        "name" => member.name,
        "rota" => rota.name,
        "date" => due_on.strftime(DATE_FORMAT),
        "days_until" => days_until
      }
    end

    # Counted from today in the *group's* zone. At 23:30 UTC a Sydney house is already tomorrow, and
    # a reminder that says "in 2 days" about a shift that is tomorrow is worse than no reminder.
    def days_until
      days = (due_on - rota.group.time_zone.today).to_i

      case days
      when 0 then "today"
      when 1 then "tomorrow"
      when 2.. then "in #{days} days"
      else "#{days.abs} #{'day'.pluralize(days.abs)} ago"
      end
    end

    def magic_link
      "#{Rails.configuration.x.sms.app_url}/s/#{member.access_token}"
    end
  end
end
