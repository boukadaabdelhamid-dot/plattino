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

interface CommuneComboboxProps {
  communes: string[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyText?: string;
  disabled?: boolean;
  className?: string;
}

export function CommuneCombobox({
  communes,
  value,
  onChange,
  placeholder = "Choisir...",
  searchPlaceholder = "Rechercher...",
  emptyText = "Aucun résultat",
  disabled = false,
  className,
}: CommuneComboboxProps) {
  const [open, setOpen] = React.useState(false);
  const [search, setSearch] = React.useState("");

  const filtered = React.useMemo(() => {
    if (!search.trim()) return communes;
    const q = search.toLowerCase().trim();
    return communes.filter((c) => c.toLowerCase().includes(q));
  }, [communes, search]);

  const handleSelect = (commune: string) => {
    onChange(commune === value ? "" : commune);
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
          disabled={disabled || communes.length === 0}
          className={cn(
            "h-8 w-full justify-between text-sm font-normal px-3",
            !value && "text-muted-foreground",
            className
          )}
        >
          <span className="truncate">{value || placeholder}</span>
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
            {filtered.length === 0 ? (
              <CommandEmpty>{emptyText}</CommandEmpty>
            ) : (
              <CommandGroup>
                {filtered.map((commune) => (
                  <CommandItem
                    key={commune}
                    value={commune}
                    onSelect={() => handleSelect(commune)}
                    className="text-sm cursor-pointer"
                  >
                    <Check
                      className={cn(
                        "mr-2 h-3.5 w-3.5",
                        value === commune ? "opacity-100" : "opacity-0"
                      )}
                    />
                    {commune}
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
