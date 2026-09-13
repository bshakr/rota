# Be sure to restart your server when you modify this file.

# Configure parameters to be partially matched (e.g. passw matches password) and filtered from the log file.
# Use this to limit dissemination of sensitive information.
# See the ActiveSupport::ParameterFilter documentation for supported notations and behaviors.
Rails.application.config.filter_parameters += [
  # `ical_url` is the house calendar's secret address (BLO-1667): anyone holding it can read the
  # whole calendar, so it is filtered here for the same reason a token is.
  :passw, :email, :phone, :secret, :token, :_key, :crypt, :salt, :certificate, :otp, :ssn, :cvv, :cvc,
  :ical_url
]
