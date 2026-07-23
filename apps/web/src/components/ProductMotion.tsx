import { useGSAP } from "@gsap/react"
import { gsap } from "gsap"
import { ScrollTrigger } from "gsap/ScrollTrigger"
import { useLocation } from "react-router-dom"

gsap.registerPlugin(useGSAP)

export function ProductMotion() {
  const { pathname } = useLocation()

  useGSAP(
    () => {
      const root = document.querySelector<HTMLElement>(".motion-root")
      if (
        !root ||
        typeof window.matchMedia !== "function" ||
        window.matchMedia("(prefers-reduced-motion: reduce)").matches
      ) {
        return
      }

      gsap.registerPlugin(ScrollTrigger)

      const entrance = root.querySelectorAll<HTMLElement>("[data-motion-enter]")
      if (entrance.length > 0) {
        gsap.fromTo(
          entrance,
          { opacity: 0, y: 24 },
          {
            opacity: 1,
            y: 0,
            duration: 0.8,
            ease: "power3.out",
            stagger: 0.07,
            clearProps: "transform",
          },
        )
      }

      const continuity = root.querySelectorAll<HTMLElement>(
        ".campaign-continuity > span, .docx-brand-flow > section",
      )
      if (continuity.length > 0) {
        gsap.fromTo(
          continuity,
          { opacity: 0, y: 18 },
          {
            opacity: 1,
            y: 0,
            duration: 0.65,
            ease: "power3.out",
            stagger: 0.09,
            clearProps: "opacity,transform",
          },
        )
      }

      const kitLayout = root.querySelector<HTMLElement>(".kit-layout")
      const kitHeading = root.querySelector<HTMLElement>(".kit-heading")
      const kitGrid = root.querySelector<HTMLElement>(".kit-grid")
      const desktop = window.matchMedia("(min-width: 64rem)").matches

      if (desktop && kitLayout && kitHeading && kitGrid) {
        ScrollTrigger.create({
          trigger: kitLayout,
          start: "top top",
          endTrigger: kitGrid,
          end: "bottom bottom",
          pin: kitHeading,
          pinSpacing: false,
          anticipatePin: 1,
        })
      }

      root.querySelectorAll<HTMLElement>(".kit-card").forEach((card) => {
        const proof = card.querySelector<HTMLElement>(".kit-proof")
        if (!proof) return

        gsap.fromTo(
          proof,
          { opacity: 0.35, scale: 0.88 },
          {
            opacity: 1,
            scale: 1,
            ease: "none",
            scrollTrigger: {
              trigger: card,
              start: "top 92%",
              end: "center 56%",
              scrub: 0.65,
            },
          },
        )

        gsap.to(proof, {
          opacity: 0.2,
          scale: 0.96,
          ease: "none",
          scrollTrigger: {
            trigger: card,
            start: "bottom 42%",
            end: "bottom top",
            scrub: 0.65,
          },
        })
      })

      const editorialReveals = root.querySelectorAll<HTMLElement>(
        ".kit-library-heading h2, .carousel-heading h1, .docx-brand-heading h1, .editor-guard-export h2",
      )
      editorialReveals.forEach((heading) => {
        gsap.fromTo(
          heading,
          { opacity: 0.25, xPercent: -5 },
          {
            opacity: 1,
            xPercent: 0,
            ease: "none",
            scrollTrigger: {
              trigger: heading,
              start: "top 88%",
              end: "top 54%",
              scrub: 0.55,
            },
          },
        )
      })
    },
    { dependencies: [pathname], revertOnUpdate: true },
  )

  return null
}
