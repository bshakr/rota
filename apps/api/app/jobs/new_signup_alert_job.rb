# Texts the operator when a brand new admin signs up. One text, one signup, nobody else told.
#
# This is the only outbound text in the app that is not addressed to a housemate, and it is the only
# one with no `sms_messages` row behind it. That is deliberate rather than an omission: SmsMessage
# requires a member, and a reminder or cover notice requires a shift too, so recording this would
# mean either inventing a member for the operator or loosening a validation that exists to stop a
# house text going out unattached to the person it is about. Neither is worth it for an alert.
#
# The consequence is written down here so nobody has to rediscover it from a number that does not
# add up: the super admin spend page counts texts by walking `sms_messages`, so this one is invisible
# to it. Roughly 4p a signup that no report will ever show. At signup volumes that is noise; if
# signups ever get big enough for it to matter, the thing to change is this comment's assumption,
# not the spend query.
#
# Sending is fire and forget by design. An operator alert that cannot be delivered must never retry
# forever and must never take a queue worker down with it, so a carrier refusal is discarded after
# being reported and a wobble gets five attempts and then the same treatment.
class NewSignupAlertJob < ApplicationJob
  queue_as :default

  # Twilio's single-segment ceiling for a GSM-7 body. The truncation below is about staying under
  # it: a name, an address and a house name are all strings a stranger chose, and three long ones
  # would otherwise turn a 4p alert into a three-segment one.
  MAX_BODY_LENGTH = 160

  # Twilio wobbles are worth waiting out, exactly as they are for a housemate's reminder. Solid
  # Queue does the waiting.
  retry_on Sms::TransientFailure, wait: :polynomially_longer, attempts: 5 do |job, error|
    job.class.gave_up(job, error, "gave up after #{job.executions} attempts")
  end

  # A bad number, a blocked recipient: asking Twilio the same question again gets the same answer,
  # and the number in question is configuration, not something a user typed. Discarded rather than
  # raised, because a job that raises here fails the queue over a notification.
  discard_on Sms::PermanentFailure do |job, error|
    job.class.gave_up(job, error, "was refused by the carrier")
  end

  # Log and report, never one or the other. The log line is for whoever is already looking; the
  # report is what tells somebody at all (sentry-rails subscribes to `Rails.error`, see
  # config/initializers/sentry.rb). A warning rather than an error: the app is fine, an operator
  # simply did not hear about a signup, which is worth knowing and is not an outage.
  def self.gave_up(job, error, what_happened)
    user_id = job.arguments.first

    Rails.logger.error(
      "NewSignupAlertJob(#{user_id}) #{what_happened}: #{error.class}: #{error.error_code}"
    )
    Rails.error.report(
      error,
      handled: true,
      severity: :warning,
      context: { user_id: user_id, error_code: error.error_code },
      source: "rotamonster.sms"
    )
  end

  def perform(user_id)
    # Re-read at run time rather than trusting the enqueue-time check in User. A minute passes
    # between the two, and a deploy that unsets the variable in that minute should text nobody.
    phone = Rails.configuration.x.sms.signup_alert_phone
    return if phone.blank?

    # Signed up and gone again inside the minute this job waits. Nothing to announce.
    user = User.find_by(id: user_id)
    return if user.nil?

    Sms.deliver(to: phone, body: body_for(user))
  end

  private

  # Everything the operator gets: who signed up, how to reach them, what they called their house,
  # and how many admins that makes. Each of the three variable fields has a stand-in for the state
  # where we do not know it yet, because a minute after signup any of them can still be missing and
  # a text reading "New Rota Monster signup:  <>." says less than nothing.
  def body_for(user)
    fit(
      name: user.name.to_s.strip.presence || "someone",
      # The stand-in address is not deliverable and never will be (see User::PLACEHOLDER_EMAIL_DOMAIN),
      # so texting it to an operator would be handing them something to try to write to.
      email: user.email_placeholder? ? nil : user.email.to_s.strip,
      house: house_for(user)
    )
  end

  # The house, if there is one yet. A user row is created by the sign-in callback and the house
  # arrives on a later request, so "none yet" is the normal reading a minute in rather than an error
  # state, and a house still wearing its JIT placeholder has been created but not named.
  def house_for(user)
    group = user.groups.first
    return "none yet" if group.nil?
    return "not named yet" if group.placeholder_name?

    group.name
  end

  # Spend what is left of the 160 on the three variable fields.
  #
  # The fixed text is measured rather than counted by hand, by composing the same message with
  # every field emptied, so that rewording the alert can never silently invalidate the budget and
  # start sending two-segment texts.
  def fit(fields)
    scaffolding = compose(fields.transform_values { |value| value && "" }).length

    compose(share(fields.compact, MAX_BODY_LENGTH - scaffolding))
  end

  # Fair shares of the budget, shortest field first, with whatever a short field does not need going
  # back into the pot for the ones behind it. A 300 character name beside a short address and a
  # short house name keeps as much of the name as the message can carry; three long ones lose the
  # same amount each. Nothing is ever cut to nothing, because a field only competes for a share of
  # what the fields shorter than it left behind.
  #
  # No ellipsis is appended to a cut field, because the ellipsis character is not in the GSM-7
  # alphabet and a single one of them would push the whole message into UCS-2, where the ceiling is
  # 70 characters rather than 160.
  def share(fields, budget)
    remaining = budget

    fields.sort_by { |_, value| value.length }.each_with_index.to_h do |(key, value), index|
      allowance = [ value.length, [ remaining / (fields.length - index), 0 ].max ].min
      remaining -= allowance

      [ key, value.first(allowance) ]
    end
  end

  def compose(fields)
    who = if fields[:email]
      "#{fields[:name]} <#{fields[:email]}>"
    else
      "#{fields[:name]}, no email shared"
    end

    "New Rota Monster signup: #{who}. House: #{fields[:house]}. Admins so far: #{admins_so_far}."
  end

  # Counted once per run, because compose is called twice, once to measure the fixed text and once
  # for real, and a signup alert is not worth two COUNT(*)s over the whole users table.
  def admins_so_far
    @admins_so_far ||= User.count
  end
end
