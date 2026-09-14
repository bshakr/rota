# The last thing that touches an event before it leaves the process.
#
# Everything in config/initializers/sentry.rb's data_collection block is a rule about what the SDK
# may COLLECT. This is the rule about what may be SENT, and it exists because collection rules are
# all key-based: they redact a header somebody named, a param somebody listed. A member's token or
# phone number reaches Sentry as the middle of a sentence instead — Twilio's own error messages
# quote the `To` number verbatim, and a magic link is a URL inside a log-derived breadcrumb — and no
# deny list catches that. So every string in every event is rewritten here, whatever field it is in.
#
# It is a plain object under app/lib, not a lambda in the initializer, so that spec/lib/
# sentry_scrubber_spec.rb can feed it a real event and prove the four rewrites still happen. A
# scrubber without that spec is the same as no scrubber, the day somebody refactors it.
module SentryScrubber
  module_function

  # An E.164 number anywhere in a string. This is the rule that catches Twilio quoting the recipient
  # back at us in a RestError message.
  PHONE = /\+[1-9]\d{6,14}/

  # A member's personal link. The path shape is the one thing about it we want to keep in an event:
  # knowing the failure happened on a magic-link page is useful, knowing whose link it was is not.
  MAGIC_LINK = %r{/s/[A-Za-z0-9_-]{20,}}

  # Any bearer credential: a member access token on /api/member/*, a WorkOS JWT on /api/*.
  BEARER = /Bearer\s+[^\s"',;]+/i

  # A bare 32-byte URL-safe token standing on its own, which is the shape Member#access_token has.
  # Lookarounds rather than \b: a token may begin or end with "-" or "_", which are not word
  # characters, and \b would then refuse to match at the token's real edges.
  BARE_TOKEN = /(?<![A-Za-z0-9_-])[A-Za-z0-9_-]{43}(?![A-Za-z0-9_-])/

  # Order matters. Bearer runs before the bare-token rule so an Authorization header reads
  # "Bearer [filtered]" rather than "Bearer [token]", and the magic-link rule runs before it so a
  # personal link keeps its recognisable shape.
  REWRITES = [
    [ PHONE, "[phone]" ],
    [ MAGIC_LINK, "/s/[token]" ],
    [ BEARER, "Bearer [filtered]" ],
    [ BARE_TOKEN, "[token]" ]
  ].freeze

  # Rewrites the event in place and returns it, which is the contract config.before_send expects:
  # returning nil would drop the event, and dropping events is not this object's job.
  def call(event)
    scrub_exception(event)
    scrub_threads(event)
    scrub_request(event)
    scrub_breadcrumbs(event)
    scrub_attributes(event)
    event
  end

  # The one place the four rules are applied. Everything else in this file exists to find the
  # strings to hand it.
  def scrub_string(value)
    REWRITES.reduce(value) { |scrubbed, (pattern, replacement)| scrubbed.gsub(pattern, replacement) }
  end

  # Hashes and arrays are rebuilt rather than mutated: some of what an event holds is frozen, and a
  # rebuilt copy is assigned back through the event's own writers below.
  def scrub_data(value)
    case value
    when String then scrub_string(value)
    when Symbol then scrub_string(value.to_s).to_sym
    when Hash then value.to_h { |key, nested| [ scrub_data(key), scrub_data(nested) ] }
    when Array then value.map { |nested| scrub_data(nested) }
    else value
    end
  end

  # An exception's message is the single likeliest carrier: "Unable to create record: The 'To'
  # number +447700900123 is not a valid phone number" is a real Twilio error.
  def scrub_exception(event)
    return unless event.respond_to?(:exception) && event.exception

    event.exception.values.each do |single|
      single.value = scrub_string(single.value.to_s)
      scrub_stacktrace(single.stacktrace)
    end
  end

  # A message event (Sentry.capture_message, and the smoke task) carries the whole caller stack on
  # the threads interface rather than on an exception, so the frames have to be reached there too.
  def scrub_threads(event)
    return unless event.respond_to?(:threads) && event.threads

    # ThreadsInterface holds its stacktrace in an ivar and exposes no reader in sentry-ruby 7.0.0.
    # Reaching past that is worth it: the alternative is a whole class of event nobody scrubs.
    scrub_stacktrace(event.threads.instance_variable_get(:@stacktrace))
  end

  # Every frame carries the source lines around it (frame_context_lines is 3 in the initializer), so
  # a literal on the line that raised travels with the event. `vars` should always be empty, because
  # data_collection.stack_frame_variables is off, and is scrubbed anyway on the day it is not.
  def scrub_stacktrace(stacktrace)
    return unless stacktrace

    stacktrace.frames.each do |frame|
      frame.context_line = scrub_string(frame.context_line) if frame.context_line.is_a?(String)
      frame.pre_context = scrub_data(frame.pre_context) if frame.pre_context
      frame.post_context = scrub_data(frame.post_context) if frame.post_context
      frame.vars = scrub_data(frame.vars) if frame.vars
    end
  end

  # Belt and braces on top of the header deny list: a request URL, and the headers themselves in
  # case a deny-list term is ever edited out of the initializer.
  def scrub_request(event)
    request = event.request
    return unless request

    request.url = scrub_string(request.url) if request.url.is_a?(String)
    request.headers = scrub_data(request.headers) if request.headers
    request.cookies = scrub_data(request.cookies) if request.cookies
    request.data = scrub_data(request.data) if request.data
    request.query_string = scrub_data(request.query_string) if request.query_string
    request.env = scrub_data(request.env) if request.env
  end

  # Breadcrumbs are where a rendered SQL statement or a logged URL turns up, and there are up to
  # thirty of them on every event.
  def scrub_breadcrumbs(event)
    return unless event.respond_to?(:breadcrumbs) && event.breadcrumbs

    event.breadcrumbs.each do |crumb|
      crumb.message = scrub_string(crumb.message.to_s) if crumb.message
      crumb.data = scrub_data(crumb.data) if crumb.data
    end
  end

  # `contexts` is where the `context:` hash from every Rails.error.report call lands, under the
  # "rails.error" key.
  def scrub_attributes(event)
    event.message = scrub_string(event.message) if event.message.is_a?(String)
    event.transaction = scrub_string(event.transaction) if event.transaction.is_a?(String)
    event.tags = scrub_data(event.tags) if event.tags
    event.extra = scrub_data(event.extra) if event.extra
    event.contexts = scrub_data(event.contexts) if event.contexts
    event.user = scrub_data(event.user) if event.user
    event.fingerprint = scrub_data(event.fingerprint) if event.fingerprint
  end
end
