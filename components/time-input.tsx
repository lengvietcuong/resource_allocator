import { Input } from "@/components/ui/input";

export function TimeInput(props: Omit<React.ComponentProps<typeof Input>, "type">) {
  return <Input type="time" {...props} />;
}
