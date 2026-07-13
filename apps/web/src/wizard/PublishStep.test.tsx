import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { expect, it, vi } from "vitest"
import { ApiProvider } from "../api/context"
import { fakeClient } from "../test/fakeApi"
import { PublishStep } from "./PublishStep"

it("congela nome e retorno enquanto publica a revisão", async () => {
  let finish!: (result: { brandRevisionId: string }) => void
  const compileDraft = vi.fn(
    () =>
      new Promise<{ brandRevisionId: string }>((resolve) => {
        finish = resolve
      }),
  )
  const onBack = vi.fn()
  const onPublished = vi.fn()
  render(
    <ApiProvider client={fakeClient({ compileDraft })}>
      <PublishStep
        draftId="draft_x"
        answers={{ "color.primary": "#1A4D8F" }}
        onBack={onBack}
        onPublished={onPublished}
      />
    </ApiProvider>,
  )

  const name = screen.getByTestId("wizard-brand-name")
  await userEvent.type(name, "ACME")
  await userEvent.click(screen.getByTestId("wizard-publicar"))

  expect(name).toBeDisabled()
  expect(screen.getByTestId("wizard-voltar")).toBeDisabled()
  expect(screen.getByTestId("wizard-publicar")).toBeDisabled()
  expect(onBack).not.toHaveBeenCalled()

  finish({ brandRevisionId: "brandrev_x" })
  await waitFor(() => expect(onPublished).toHaveBeenCalledWith("brandrev_x"))
})
