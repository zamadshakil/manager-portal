export { default, generateMetadata } from "@/app/showcase/for/[segment]/page";
export function generateStaticParams() {
  return ["agencies", "ecommerce", "training"].map((segment) => ({ segment }));
}
