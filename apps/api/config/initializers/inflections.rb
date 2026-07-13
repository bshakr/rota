# Be sure to restart your server when you modify this file.

# Add new inflection rules using the following format. Inflections
# are locale specific, and you may define rules for as many different
# locales as you wish. All of these examples are active by default:
# ActiveSupport::Inflector.inflections(:en) do |inflect|
#   inflect.plural /^(ox)$/i, "\\1en"
#   inflect.singular /^(ox)en/i, "\\1"
#   inflect.irregular "person", "people"
#   inflect.uncountable %w( fish sheep )
# end

# These inflection rules are supported but not enabled by default:
# ActiveSupport::Inflector.inflections(:en) do |inflect|
#   inflect.acronym "RESTful"
# end

# DO NOT REMOVE. Without this, "rota" is treated as a Latin plural.
#
# The default inflector's `/([ti])a$/` rules exist for data/datum and criteria/criterion, and
# "rota" ends in "ta". So out of the box `"rota".pluralize` is "rota" and `"rota".classify` is
# "Rotum" — meaning the Rota model looks for a table called `rota`, `t.references :rota` builds a
# foreign key to `rota`, and `has_many :rotas` resolves to nothing. Rota is an ordinary English
# noun that pluralises to "rotas"; declaring it irregular is what makes every one of those work.
ActiveSupport::Inflector.inflections(:en) do |inflect|
  inflect.irregular "rota", "rotas"
end
