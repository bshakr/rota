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
# being reported, a wobble gets five attempts and then the same treatment, and anything unexpected
# is reported and dropped rather than raised.
class NewSignupAlertJob < ApplicationJob
  queue_as :default

  # Twilio bills per segment, and a body made only of GSM-7 septets fits 160 of them in one segment.
  # That ceiling only holds because every variable field is put through #sanitise first, so by the
  # time anything is measured there is no accented letter left to force the whole message into UCS-2
  # (where the ceiling is 70 characters, not 160), no emoji, and none of the GSM-7 extension
  # characters that cost two septets apiece. One character in this body is one septet, so counting
  # Ruby characters to 160 is counting septets to one segment.
  MAX_BODY_LENGTH = 160

  # The characters allowed to survive sanitisation, as a String#delete set: letters, digits, space,
  # and the punctuation an alert actually uses. Deliberately narrower than the full GSM-7 basic
  # alphabet, which also carries £, §, Ø and the Greek capitals that nothing here needs: a set
  # small enough to check by eye is worth more than a rare character rendered faithfully. The `-` is
  # last because anywhere else `delete` would read it as a range.
  GSM7_ALLOWED = "A-Za-z0-9 .,@<>_'+:/()!?&#-".freeze

  # How much of the name and of the house name has to survive for the alert to still say something
  # about them. An address reserved in full at the cost of leaving twelve characters each is not a
  # trade worth making, so past that point the address is dropped instead.
  MIN_FIELD_LENGTH = 12

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
  rescue Sms::TransientFailure, Sms::PermanentFailure
    # Both of these already have somewhere to be (retry_on's backoff and discard_on's report), and
    # the catch-all below would swallow them on the way there, turning a wobble that would have
    # healed on the second attempt into an alert nobody ever gets. Same shape as SendSmsJob: name
    # the failures that are handled elsewhere before the catch-all can reach them.
    raise
  rescue StandardError => e
    # The catch-all. Anything else on this path is a bug or the infrastructure having a bad moment:
    # `User.count` on a dropped connection, a misconfigured adapter raising ArgumentError, a nil
    # somewhere in the budgeting. None of it is worth failing a queue job over, because the worst
    # outcome available here is already "the operator did not hear about a signup" and raising only
    # adds a red job to it. Reported so somebody finds out, at warning, for the same reason
    # .gave_up reports at warning.
    Rails.logger.error("NewSignupAlertJob(#{user_id}) unexpected #{e.class}: #{e.message}")
    Rails.error.report(
      e,
      handled: true,
      severity: :warning,
      context: { user_id: user_id },
      source: "rotamonster.sms"
    )
  end

  private

  # Everything the operator gets: who signed up, how to reach them, what they called their house,
  # and how many admins that makes. Each of the three variable fields has a stand-in for the state
  # where we do not know it yet, because a minute after signup any of them can still be missing and
  # a text reading "New Rota Monster signup:  <>." says less than nothing. The stand-ins go on after
  # sanitising rather than before, because sanitising can empty a field too: a name that was nothing
  # but emoji is a name we do not have.
  def body_for(user)
    fit(
      name: sanitise(user.name).presence || "someone",
      # The stand-in address is not deliverable and never will be (see User::PLACEHOLDER_EMAIL_DOMAIN),
      # so texting it to an operator would be handing them something to try to write to.
      email: user.email_placeholder? ? nil : sanitise(user.email).presence,
      house: sanitise(house_for(user)).presence || "not named yet"
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

  # Every character that reaches the body has to be a single GSM-7 septet, so every field a stranger
  # chose comes through here before anything is measured or sent. Three passes and a tidy-up:
  # `squish` flattens the newlines and runs of spaces that a paste into a name field leaves behind;
  # `I18n.transliterate` turns Zoë into Zoe and drops what it has no approximation for, emoji
  # included; `delete` takes out whatever is left outside GSM7_ALLOWED, which is where the extension
  # characters ~ [ ] { } | ^ \ € go, and those read as ordinary punctuation while quietly costing
  # two septets each. The closing squish closes the gaps the dropped characters left behind.
  #
  # An address goes through the same wash as the other two. In practice that changes nothing, since
  # the addresses people sign in with are ASCII, and an address that could only be carried by
  # sending a 70-character UCS-2 message is not one this alert can carry.
  def sanitise(value)
    I18n.transliterate(value.to_s.squish, replacement: "").delete("^#{GSM7_ALLOWED}").squish
  end

  # Spend what is left of the 160 on the three variable fields, the address first.
  #
  # An address is whole or it is absent, never trimmed. Cut like the other two it becomes
  # "<alexandra.constantinopoulos@hollandan>", which reads as perfectly deliverable; the operator
  # writes to it, hears nothing back, and has no way to tell that from being ignored. So the address
  # is reserved in full before the name and the house are given anything. If reserving it would
  # leave those two less than MIN_FIELD_LENGTH characters each it is not sent at all, and the
  # operator is told the address was too long rather than handed a broken one. They still get the
  # name, the house and the count, and they can look the person up.
  def fit(name:, email:, house:)
    if email
      room = room_left(email: "") - email.length
      return compose(email: email, **share(name, house, room)) if room >= 2 * MIN_FIELD_LENGTH
    end

    missing = email ? "email too long to text" : "no email shared"
    compose(missing_email: missing, **share(name, house, room_left(missing_email: missing)))
  end

  # What is left of the 160 once the fixed text is paid for. The fixed text is measured rather than
  # counted by hand, by composing the same message with the variable fields emptied, so that
  # rewording the alert can never silently invalidate the budget and start sending two-segment
  # texts. The layout matters to the measurement: "<>" and ", no email shared" are not the same
  # width, so each branch measures its own.
  def room_left(**layout)
    MAX_BODY_LENGTH - compose(name: "", house: "", **layout).length
  end

  # Fair shares of what the address left behind, shortest field first, with whatever a short field
  # does not need going back into the pot for the one behind it. A 300 character name beside a short
  # house name keeps as much of the name as the message can carry; two long ones lose the same
  # amount each. Neither is ever cut to nothing, because a field only competes for a share of what
  # the field shorter than it left behind.
  #
  # No ellipsis is appended to a cut field, because the ellipsis character is not in the GSM-7
  # alphabet and a single one of them would push the whole message into UCS-2, where the ceiling is
  # 70 characters rather than 160.
  def share(name, house, budget)
    fields = { name: name, house: house }
    remaining = budget

    fields.sort_by { |_, value| value.length }.each_with_index.to_h do |(key, value), index|
      allowance = [ value.length, [ remaining / (fields.length - index), 0 ].max ].min
      remaining -= allowance

      [ key, value.first(allowance) ]
    end
  end

  def compose(name:, house:, email: nil, missing_email: "no email shared")
    who = if email
      "#{name} <#{email}>"
    else
      "#{name}, #{missing_email}"
    end

    "New Rota Monster signup: #{who}. House: #{house}. Admins so far: #{admins_so_far}."
  end

  # Counted once per run, because compose is called twice, once to measure the fixed text and once
  # for real, and a signup alert is not worth two COUNT(*)s over the whole users table.
  def admins_so_far
    @admins_so_far ||= User.count
  end
end
