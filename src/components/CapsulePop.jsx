
import { motion } from "framer-motion";

export default function CapsulePop({ children, trigger, className }) {
  return (
    <motion.div
      key={trigger}
      className={className}
      initial={{ scale: 0.3, rotate: -12, opacity: 0 }}
      animate={{
        scale: [0.3, 1.25, 0.92, 1.05, 1],
        rotate: [-12, 8, -4, 0],
        opacity: 1,
      }}
      transition={{ duration: 0.7, times: [0, 0.35, 0.6, 0.82, 1], ease: "easeOut" }}
    >
      {children}
    </motion.div>
  );
}

