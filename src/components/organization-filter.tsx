import { RiBuildingLine } from "@remixicon/react"

import { FilterPopover } from "@/components/filter-popover"

export function OrganizationFilter({
  organizations,
  value,
  onChange,
}: {
  organizations: { id: string; name: string }[]
  value: string
  onChange: (organizationId: string) => void
}) {
  return (
    <FilterPopover
      noun="organization"
      pluralNoun="organizations"
      icon={RiBuildingLine}
      options={organizations}
      value={value}
      onChange={onChange}
    />
  )
}
