# Public recovery of an EXISTING member's personal link, never account creation.
class HouseholdEntry
  def self.request_link(slug:, phone:)
    return unless slug.is_a?(String) && slug.bytesize <= 80 && phone.is_a?(String) && phone.bytesize <= 40

    parsed = Phonelib.parse(phone, Phonelib.default_country)
    return unless parsed.valid?

    message = nil
    SmsMessage.transaction do
      # One small global lock serializes the check+claim across API processes.
      # Limits count persisted attempts, including failures, not only successful sends.
      # This does not trust forwarded IP headers or reset on cache eviction/redeploy.
      SmsMessage.connection.execute("SELECT pg_advisory_xact_lock(728614902)")
      group = Group.find_by(slug: slug)
      next unless group

      members = group.members.contactable.where(phone_e164: parsed.e164).limit(2).to_a
      next unless members.one? # A shared/duplicate number must not pick an arbitrary identity.

      recent = SmsMessage.member_login.where(created_at: 1.hour.ago..)
      next if recent.count >= 100
      next if recent.joins(:member).where(members: { group_id: group.id }).count >= 60
      daily = SmsMessage.member_login.where(created_at: 24.hours.ago..)
      next if daily.count >= 200
      next if daily.joins(:member).where(members: { phone_e164: parsed.e164 }).count >= 5

      for_phone = recent.joins(:member).where(members: { phone_e164: parsed.e164 })
      next if for_phone.count >= 3 || for_phone.where(created_at: 1.minute.ago..).exists?

      message = SmsMessage.create!(member: members.first, kind: :member_login)
    end
    SendSmsJob.perform_later(message.id) if message
    nil
  end
end
