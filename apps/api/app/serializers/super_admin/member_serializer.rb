module SuperAdmin
  # A housemate as the operator sees them.
  #
  # This class exists so that redaction is STRUCTURAL. The house's own MemberSerializer exposes
  # `access_token` on purpose — it is the member's magic link, and handing it out is a core admin
  # action. That token is a permanent login to somebody else's house, and an operator never needs
  # it to answer any question this console asks. So the operator's serializer does not omit it by
  # remembering to: it is a different class, and there is no branch anywhere that could turn this
  # one back into that one.
  #
  # The phone number IS here, in full. That is the decision in the plan, and it is the opposite
  # decision from the token for a concrete reason: "why didn't Alice get her text" is usually
  # answered by looking at the number — a wrong country code, a landline, the same number entered
  # twice — and a masked number answers none of them.
  class MemberSerializer < ApplicationSerializer
    ACTIVE = "active".freeze
    OPTED_OUT = "opted_out".freeze
    REMOVED = "removed".freeze

    def as_json
      {
        id: record.id,
        name: record.name,
        phone_e164: record.phone_e164,
        status: status,
        sms_opted_out_at: record.sms_opted_out_at,
        # Which rotas this person actually sits on — the question behind "why is this house sending
        # no texts" when it turns out everyone is a member of nothing.
        rotas: record.rotas.map { |rota| { id: rota.id, name: rota.name } }
      }
    end

    private

    # Three states, in the order they override each other. "Removed" is deactivation, never a
    # destroy: a member who appears in shift history is the record of who was actually responsible
    # (see MemberRemoval), so leaving the house sets `active` to false and nothing is erased.
    def status
      return REMOVED unless record.active?
      return OPTED_OUT if record.sms_opted_out_at.present?

      ACTIVE
    end
  end
end
