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
    # The belt to that brace. If a link ever reaches a body in a shape the pattern above does not
    # match, the whole line goes, so a token can never survive this method. The replacement is the
    # line the plan names, because the line it replaces is almost always the "Manage:" one.
    MAGIC_LINK_LINE = %r{^.*/s/.*$}

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

    def redacted_body
      # A row that has not been sent yet has no body at all, and `nil` is the honest answer for it
      # — an empty string would read as "we sent a blank text".
      return if record.body.nil?

      body = record.body.gsub(MAGIC_LINK, REDACTED_LINK)
      return body unless body.include?("/s/")

      body.gsub(MAGIC_LINK_LINE, "Manage: #{REDACTED_LINK}")
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
