# Be sure to restart your server when you modify this file.

# Configure parameters to be partially matched (e.g. passw matches password) and filtered from the log file.
# Use this to limit dissemination of sensitive information.
# See the ActiveSupport::ParameterFilter documentation for supported notations and behaviors.
Rails.application.config.filter_parameters += [
  # `ical_url` is the house calendar's secret address (BLO-1667): anyone holding it can read the
  # whole calendar, so it is filtered here for the same reason a token is.
  #
  # `notes` is the operator's private note about a house (BLO-1675) — free text about the people who
  # live there, and the one field on the super admin PATCH whose CONTENT must not reach the log. The
  # audit line that endpoint writes says only that a note was replaced or cleared; without this
  # entry, Rails' own `Parameters:` line would print the whole thing anyway and make that care
  # pointless.
  :passw, :email, :phone, :secret, :token, :_key, :crypt, :salt, :certificate, :otp, :ssn, :cvv, :cvc,
  :ical_url, :notes
]
