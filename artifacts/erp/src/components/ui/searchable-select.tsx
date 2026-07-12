import * as React from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

export interface SearchableSelectOption {
  value: string;
  labelFr: string;
  labelAr?: string;
  hexCode?: string | null;
}

interface SearchableSelectProps {
  value: string;
  onValueChange: (value: string) => void;
  options: SearchableSelectOption[];
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  noneLabel?: string;
  noneValue?: string;
  className?: string;
  disabled?: boolean;
}

export function SearchableSelect({
  value,
  onValueChange,
  options,
  placeholder = "Sélectionner...",
  searchPlaceholder = "Rechercher...",
  emptyText = "Aucun résultat",
  noneLabel = "— Aucun —",
  noneValue = "__none__",
  className,
  disabled = false,
}: SearchableSelectProps) {
  const [open, setOpen] = React.useState(false);
  const [search, setSearch] = React.useState("");

  const filtered = React.useMemo(() => {
    const q = search.toLowerCase().trim();
    if (!q) return options;
    return options.filter(
      (o) =>
        o.labelFr.toLowerCase().includes(q) ||
        (o.labelAr ?? "").toLowerCase().includes(q)
    );
  }, [options, search]);

  const selected = options.find((o) => o.value === value);

  const handleSelect = (val: string) => {
    onValueChange(val === noneValue ? "" : val);
    setOpen(false);
    setSearch("");
  };

  React.useEffect(() => {
    if (!open) setSearch("");
  }, [open]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className={cn(
            "h-8 w-full justify-between text-sm font-normal px-3",
            !selected && "text-muted-foreground",
            className
          )}
        >
          <span className="truncate flex items-center gap-1.5">
            {selected ? (
              <>
                {selected.hexCode && (
                  <span
                    className="inline-block w-3 h-3 rounded-full border shrink-0"
                    style={{ backgroundColor: selected.hexCode }}
                  />
                )}
                {selected.labelFr}
              </>
            ) : (
              placeholder
            )}
          </span>
          <ChevronsUpDown className="ml-2 h-3.5 w-3.5 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-[var(--radix-popover-trigger-width)] p-0"
        align="start"
        side="bottom"
        avoidCollisions
        style={{ zIndex: 9999 }}
      >
        <Command shouldFilter={false}>
          <CommandInput
            placeholder={searchPlaceholder}
            value={search}
            onValueChange={setSearch}
            className="h-8 text-sm"
          />
          <CommandList className="max-h-[220px]">
            {filtered.length === 0 && search ? (
              <CommandEmpty>{emptyText}</CommandEmpty>
            ) : (
              <CommandGroup>
                {/* "none" option always visible */}
                <CommandItem
                  value={noneValue}
                  onSelect={() => handleSelect(noneValue)}
                  className="text-sm cursor-pointer text-muted-foreground"
                >
                  <Check
                    className={cn(
                      "mr-2 h-3.5 w-3.5 shrink-0",
                      !value ? "opacity-100" : "opacity-0"
                    )}
                  />
                  {noneLabel}
                </CommandItem>
                {filtered.map((opt) => (
                  <CommandItem
                    key={opt.value}
                    value={opt.value}
                    onSelect={() => handleSelect(opt.value)}
                    className="text-sm cursor-pointer"
                  >
                    <Check
                      className={cn(
                        "mr-2 h-3.5 w-3.5 shrink-0",
                        value === opt.value ? "opacity-100" : "opacity-0"
                      )}
                    />
                    <span className="flex items-center gap-1.5 truncate">
                      {opt.hexCode && (
                        <span
                          className="inline-block w-3 h-3 rounded-full border shrink-0"
                          style={{ backgroundColor: opt.hexCode }}
                        />
                      )}
                      {opt.labelFr}
                      {opt.labelAr && (
                        <span
                          className="ml-1 text-xs text-muted-foreground"
                          dir="rtl"
                        >
                          / {opt.labelAr}
                        </span>
                      )}
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
