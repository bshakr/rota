# A person who takes turns. `access_token` is deliberately exposed: it is the member's magic link,
# and handing it out — copying the link, texting it — is a core admin action, so the admin API is
# where it belongs. `contactable` folds "active and not opted out" into the one boolean the UI acts
# on, rather than making the client re-derive the rule the reminder sweep already owns.
class MemberSerializer < ApplicationSerializer
  def as_json
    {
      id: record.id,
      name: record.name,
      phone_e164: record.phone_e164,
      active: record.active,
      contactable: record.contactable?,
      sms_opted_out_at: record.sms_opted_out_at,
      access_token: record.access_token
    }
  end
end
