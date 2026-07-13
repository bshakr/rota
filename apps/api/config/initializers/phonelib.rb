# A bad phone number is the top cause of a silently missed reminder, so numbers are normalised to
# E.164 and validated with libphonenumber at entry — rejected at the form, not discovered three
# weeks later when nobody cleaned the kitchen. See Member#phone_e164.
#
# A number typed in national form ("07123 456789") carries no country, so parsing one needs a
# default. The first houses are British; a deployment elsewhere sets DEFAULT_PHONE_COUNTRY to its
# own ISO 3166-1 alpha-2 code rather than editing this file.
Phonelib.default_country = ENV.fetch("DEFAULT_PHONE_COUNTRY", "GB")
