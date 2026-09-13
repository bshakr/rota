module SuperAdmin
  # One line of a house's delivery log, as the operator reads it.
  #
  # Same question as the house's own log — "why didn't Alice get her text" — and almost the same
  # row, with one difference that is the reason this is a separate class: every text this product
  # sends carries the recipient's magic link, and that link is a permanent login to the house.
  # The operator needs the body (a template with a stray placeholder, a message truncated to
  # nothing) and never needs the credential inside it, so the link is replaced before the body is
  # rendered, structurally, by the only serializer this namespace has.
  class SmsMessageSerializer < ApplicationSerializer
    # What the operator sees where the link was. Deliberately not a partial token: half a
    # credential in a screenshot is still half a credential, and it is not a fact anyone needs.
    REDACTED_LINK = "[link]".freeze

    # The link as it is actually composed, in both places it is composed. Sms::Renderer appends
    # "\nManage: <app_url>/s/<token>" to every reminder and cover notice, and SendSmsJob writes
    # "Your Rota Monster personal link: <app_url>/s/<token>" for a member login. Both are one
    # unbroken run of non-space characters ending in the token, so matching the whole URL leaves
    # the sentence around it intact and readable.
    MAGIC_LINK = %r{\S*/s/\S+}
    # The belt to that brace: a line still carrying a `/s/` with something after it lost its link
    # in some shape the pattern above did not match, so the whole line goes. Both patterns require
    # that something — a bare "/s/" with nothing after it is not a credential, and a sentence like
    # "see https://ourhouse.example/s/ for the rota" should survive being read rather than be
    # blanked because it mentioned a path.
    MAGIC_LINK_LINE = %r{^.*/s/\S+.*$}

    # The serializer is reached through these two, so the token sweep below always has the tokens it
    # needs without each row going and finding them. `many` asks once for the whole page.
    def self.many(messages)
      messages = messages.to_a

      access_tokens = access_tokens_for(messages)
      messages.map { |message| new(message, access_tokens: access_tokens).as_json }
    end

    def self.one(message, access_tokens: nil)
      message && new(message, access_tokens: access_tokens || access_tokens_for([ message ])).as_json
    end

    # Every magic-link token belonging to the houses this page of messages came from, in one query
    # rather than one per row. They are read in order to be struck out, never to be served.
    def self.access_tokens_for(messages)
      group_ids = messages.filter_map { |message| message.member&.group_id }.uniq
      return [] if group_ids.empty?

      Member.where(group_id: group_ids).pluck(:access_token)
    end

    def initialize(record, access_tokens: [])
      super(record)
      @access_tokens = access_tokens
    end

    def as_json
      {
        id: record.id,
        kind: record.kind,
        status: record.status,
        error_code: record.error_code,
        days_before: record.days_before,
        body: redacted_body,
        twilio_sid: record.twilio_sid,
        sent_at: record.sent_at,
        created_at: record.created_at,
        member: member,
        shift: shift
      }
    end

    private

    attr_reader :access_tokens

    # Three passes, narrowing from the shape of a link to the credential itself.
    def redacted_body
      # A row that has not been sent yet has no body at all, and `nil` is the honest answer for it
      # — an empty string would read as "we sent a blank text".
      return if record.body.nil?

      body = record.body.gsub(MAGIC_LINK, REDACTED_LINK)
      body = body.gsub(MAGIC_LINK_LINE, "Manage: #{REDACTED_LINK}") if body.match?(MAGIC_LINK_LINE)

      # The last pass is the only one that does not care what shape the credential arrived in. The
      # two above look for a link; this looks for the token, so a body that carries one with no URL
      # around it at all — a pasted fragment, a template somebody hand-edited, a shape this code
      # has not imagined — still cannot leave the server.
      access_tokens.reduce(body) { |text, token| text.gsub(token, REDACTED_LINK) }
    end

    # The number is here for the same reason it is on SuperAdmin::MemberSerializer: a failed
    # delivery is usually a fact about the number, and the log is where it is being read.
    def member
      { id: record.member_id, name: record.member.name, phone_e164: record.member.phone_e164 }
    end

    def shift
      return nil unless record.shift

      {
        id: record.shift_id,
        rota_id: record.shift.rota_id,
        rota_name: record.shift.rota.name,
        due_on: record.shift.due_on
      }
    end
  end
end
